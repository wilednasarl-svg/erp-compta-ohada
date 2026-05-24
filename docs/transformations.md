# Module 4 — Transformation Engine

> **Invariant fondamental (D1)** : une écriture source (`import_staging_entries`) n'est **jamais modifiée**. Toute transformation est un artefact indépendant (`entry_transformations`) qui capture le diff `before_values` / `after_values`. L'état effectif d'une écriture est `raw_values` + la chaîne de transformations actives.

## Types de transformation

| Type | Description | Wave |
|---|---|---|
| `reclassification` | Change compte, journal, analytique ou libellé sans toucher la ligne source | 1 |
| `adjustment` | Crée une écriture d'ajustement (régularisation) liée à la source | 1 |
| `correction` | Corrige un libellé, une date, une référence ou un tiers | 2 |
| `ventilation` | Éclate une écriture sur plusieurs comptes | 2 |
| `grouping` | Regroupe plusieurs écritures (annotation) | 2 |

## Statuts

| Statut | Description |
|---|---|
| `active` | Transformation effective |
| `cancelled` | Soft-delete — annulée mais conservée pour l'historique |

## Champs reclassifiables (`ReclassifiableField`)

`account` · `journal` · `partner` · `label`

## Diff JSONB (`TransformationDiff`)

Sparse par conception — seuls les champs modifiés sont enregistrés :

```json
{
  "account": "401000",
  "journal": null
}
```

Pour le type `adjustment`, le diff contient `adjustmentDebit` XOR `adjustmentCredit` (positif) + `adjustmentLabel`.

---

## Endpoints

Base : `POST|GET /organizations/:orgId/transformations`

| Méthode | Chemin | Permission | HTTP | Description |
|---|---|---|---|---|
| POST | `/reclassify` | `transformations.write` | 201 | Reclassement d'une écriture source |
| POST | `/adjust` | `transformations.write` | 201 | Ajustement (écriture de régularisation) |
| GET | `/entries/:entryId/history` | `transformations.read` | 200 | Historique complet d'une écriture |

### POST `/reclassify`

```json
{
  "sourceEntryId": "uuid",
  "account": "606100",
  "journal": null,
  "partner": null,
  "label": "Fournitures bureau corrigé",
  "notes": "Correction suite à rapprochement"
}
```

Au moins un champ parmi `account`, `journal`, `partner`, `label` est requis — sinon `TRANSFORMATION_NO_FIELD_CHANGED` (422).

### POST `/adjust`

```json
{
  "sourceEntryId": "uuid",
  "adjustmentDebit": "150.00",
  "adjustmentLabel": "Régularisation charges N-1",
  "notes": "Écart arrondi"
}
```

Exactement un de `adjustmentDebit` / `adjustmentCredit` doit être fourni — sinon `TRANSFORMATION_ADJUSTMENT_INVALID` (422).

### GET `/entries/:entryId/history`

Retourne la chaîne complète (actives + annulées) dans l'ordre chronologique `createdAt ASC` :

```json
[
  {
    "id": "uuid",
    "type": "reclassification",
    "status": "active",
    "sourceEntryId": "uuid",
    "beforeValues": { "account": "401000" },
    "afterValues": { "account": "401100" },
    "notes": null,
    "createdById": "user-uuid",
    "createdAt": "2026-05-24T10:00:00Z",
    "cancelledAt": null,
    "cancelReason": null
  }
]
```

---

## Exemples curl

```bash
BASE="https://backend-production-44c2.up.railway.app"
ORG="<org-uuid>"
TOKEN="<scoped-access-token>"

# Reclassement
curl -sX POST "$BASE/organizations/$ORG/transformations/reclassify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourceEntryId":"<entry-uuid>","account":"606100","notes":"Correction poste"}'

# Ajustement
curl -sX POST "$BASE/organizations/$ORG/transformations/adjust" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourceEntryId":"<entry-uuid>","adjustmentDebit":"150.00","adjustmentLabel":"Régul N-1"}'

# Historique
curl -s "$BASE/organizations/$ORG/transformations/entries/<entry-uuid>/history" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Codes d'erreur

| Code | HTTP | Déclencheur |
|---|---|---|
| `TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` | 404 | Écriture source absente ou hors tenant |
| `TRANSFORMATION_NO_FIELD_CHANGED` | 422 | `POST /reclassify` sans aucun champ modifié |
| `TRANSFORMATION_ADJUSTMENT_INVALID` | 422 | `POST /adjust` avec les deux champs XOR manquants |

---

## Invariants de conception

**D1 — Immuabilité des sources** : `import_staging_entries` n'est jamais écrit par `TransformationService`. La lecture de l'état effectif d'une écriture doit parcourir la chaîne de transformations actives.

**D2 — Traçabilité** : chaque transformation est un artefact indépendant avec `before_values` + `after_values` + auteur + timestamp. L'audit trail est émis via `AuditTrailService` (`module: 'transformations'`, actions `entry_reclassified` / `entry_adjusted`).

**D3 — Soft-delete** : une transformation annulée passe à `status='cancelled'` mais reste en base pour l'historique. Aucune ligne n'est supprimée en wave 1.

**D4 — Isolation tenant** : `resolveSourceEntry` fait un JOIN `import_sessions.organization_id = orgId` — un appel cross-tenant retourne `TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` (fail-closed, jamais un 403 qui confirmerait l'existence de l'objet).
