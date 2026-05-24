# Module 5 — Moteur de règles

## Pourquoi

Les cabinets OHADA appliquent des **règles d'automatisation comptable répétitives** :
reclassement systématique de comptes 40x vers 401xxx, étiquetage des flux BQ,
affectation de centres de coûts selon le journal. Sans moteur de règles, chaque
reclassement est manuel via Module 4 (Transformation Engine), ce qui est coûteux à l'échelle.

Module 5 fournit un moteur de règles déclaratif :

- **Définir** une règle avec des conditions (filtres) et des actions (mutations).
- **Simuler** son impact sans rien modifier.
- **Appliquer** pour créer des transformations réelles via `TransformationService`.
- **Auditer** chaque exécution via une `rule_execution` append-only.

Invariant : les écritures sources (`import_staging_entries`) ne sont **jamais**
modifiées directement — toute mutation passe par `TransformationService` (Module 4).

---

## DSL conditions / actions (union discriminée)

### Conditions (`RuleCondition`)

Chaque condition est un objet avec un champ `type` discriminant. Toutes les conditions
d'une règle sont évaluées en **AND** (toutes doivent matcher pour que l'écriture soit
concernée).

| `type` | Champs supplémentaires | Comportement |
|---|---|---|
| `account_prefix` | `prefix: string` | `mappedValues.account` commence par `prefix` |
| `account_in` | `accounts: string[]` | `mappedValues.account` dans la liste |
| `journal_in` | `journals: string[]` | `mappedValues.journal` dans la liste |
| `amount_range` | `side: 'debit'|'credit'|'any'`, `min?: number`, `max?: number` | Montant du côté spécifié dans `[min, max]` |
| `label_contains` | `substring: string` | `mappedValues.label` contient `substring` (insensible à la casse) |
| `date_range` | `from?: string`, `to?: string` | `mappedValues.date` dans `[from, to]` (ISO 8601 `YYYY-MM-DD`) |

### Actions (`RuleAction`)

| `type` | Champs supplémentaires | Effet (via TransformationService) |
|---|---|---|
| `reclassify_account` | `targetAccount: string` | Crée une `entry_transformation` type `reclassification` sur le champ `account` |
| `reclassify_journal` | `targetJournal: string` | Crée une `entry_transformation` type `reclassification` sur le champ `journal` |
| `assign_cost_center` | `costCenter: string` | Stocke le centre de coûts dans le champ `partner` (vague 1 — champ dédié en vague 2) |
| `add_tag` | `tag: string` | Concatène `[tag]` au libellé via `reclassification` sur `label` |

---

## Cycle de vie d'une exécution

```
create rule → simulate (mode='simulation') → apply (mode='apply') → get executions
```

Chaque `POST /:ruleId/simulate` ou `POST /:ruleId/apply` produit une ligne
`rule_executions` immuable (append-only) avec :
- `mode` : `simulation` ou `apply`
- `matched_count` / `applied_count`
- `matches_snapshot` : JSONB array des matchs (entryId + actions + transformationIds)
- `error` : message si une transformation a partiellement échoué (apply continue les entrées restantes)

---

## Endpoints

Base : `POST|GET|PATCH /organizations/:id/rules`

| Méthode | URL | Permission | Description |
|---|---|---|---|
| `POST` | `/rules` | `rules.write` | Créer une règle |
| `GET` | `/rules` | `rules.read` | Lister les règles de l'org |
| `GET` | `/rules/:ruleId` | `rules.read` | Détail d'une règle |
| `PATCH` | `/rules/:ruleId` | `rules.write` | Mettre à jour (nom, conditions, actions, priorité, statut) |
| `POST` | `/rules/:ruleId/simulate` | `rules.simulate` | Simuler — aucune transformation créée |
| `POST` | `/rules/:ruleId/apply` | `rules.apply` | Appliquer — transformations créées via Module 4 |
| `GET` | `/rules/:ruleId/executions` | `rules.read` | Historique des exécutions |

---

## Scope d'exécution (`ExecuteRuleDto`)

`simulate` et `apply` acceptent un corps optionnel pour restreindre le périmètre :

```json
{
  "importSessionId": "uuid",
  "journal": "BQ",
  "dateFrom": "2026-01-01",
  "dateTo": "2026-03-31"
}
```

Corps vide `{}` → toutes les écritures staging de l'org sont évaluées.

---

## Exemples curl

### Créer une règle

```bash
curl -X POST https://api.example.com/organizations/$ORG_ID/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Reclasser comptes 40x → 401100",
    "isActive": true,
    "priority": 100,
    "conditions": [
      { "type": "account_prefix", "prefix": "40" },
      { "type": "journal_in", "journals": ["AC"] }
    ],
    "actions": [
      { "type": "reclassify_account", "targetAccount": "401100" }
    ]
  }'
```

### Simuler

```bash
curl -X POST https://api.example.com/organizations/$ORG_ID/rules/$RULE_ID/simulate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "importSessionId": "'$SESSION_ID'" }'
```

Réponse :
```json
{
  "data": {
    "ruleId": "...",
    "mode": "simulation",
    "matchedCount": 12,
    "appliedCount": 0,
    "matches": [
      {
        "entryId": "...",
        "actions": [{ "type": "reclassify_account", "targetAccount": "401100" }],
        "transformationIds": null
      }
    ]
  }
}
```

### Appliquer

```bash
curl -X POST https://api.example.com/organizations/$ORG_ID/rules/$RULE_ID/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "importSessionId": "'$SESSION_ID'" }'
```

Réponse : idem simulate mais `mode: "apply"`, `appliedCount: 12`, `transformationIds: ["..."]`.

---

## Codes d'erreur

| Code | HTTP | Déclencheur |
|---|---|---|
| `RULE_NOT_FOUND` | 404 | Règle introuvable ou hors tenant |
| `RULE_INVALID_CONDITION` | 422 | Type de condition inconnu dans le DSL |
| `RULE_INVALID_ACTION` | 422 | Type d'action inconnu dans le DSL |

---

## Invariants et design

- **D1 — Séparation définition / exécution** : `rules` stocke le DSL déclaratif ;
  `rule_executions` stocke l'historique immuable d'exécution. Modifier une règle ne
  rétroagit pas sur les executions passées.
- **D2 — Immutabilité des sources** : les `import_staging_entries` ne sont jamais
  touchées. Chaque action crée une `entry_transformation` via `TransformationService`.
- **D3 — Apply partial failure** : si une transformation échoue pour une écriture, le
  moteur continue les entrées restantes et consigne l'erreur dans `rule_executions.error`.
  Le caller peut ré-appliquer après correction.
- **D4 — Priorité** : les règles ont un champ `priority` (entier ≥ 0, ascending =
  priorité haute). En vague 1, chaque règle est appliquée indépendamment ; l'ordre
  d'application déterministe est prévu en vague 2.
