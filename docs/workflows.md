# Module 6 — Workflow Engine

> Le moteur de workflow gère le cycle de vie d'objets métier (vague 1 : `import_session`) via une machine d'états strictement définie. L'invariant central est `assertNotLocked` — les modules métier appellent cette méthode avant toute mutation pour bloquer les opérations sur un objet verrouillé.

## Machine d'états

```
  ┌───────────────────────────────────────────────┐
  │                                               │
  ▼                                               │
draft ──► in_review ──► approved ──► locked      │
              │             │                    │
              └─────────────┘ (retour possible)  │
              (approved → in_review OK)          │
              (in_review → draft OK)             │
                                                  │
locked = terminal (aucune transition possible) ◄──┘ (non, locked est terminal)
```

| De | Vers | Permission requise |
|---|---|---|
| `draft` | `in_review` | `workflows.write` |
| `in_review` | `draft` | `workflows.write` |
| `in_review` | `approved` | `workflows.approve` |
| `approved` | `in_review` | `workflows.write` |
| `approved` | `locked` | `workflows.approve` |
| `locked` | (aucune) | — terminal |

`locked` est **irréversible** en wave 1. Un objet `locked` bloque toute mutation via `assertNotLocked`.

---

## Endpoints

Base : `/workflows` (préfixé org via `TenantGuard`)

| Méthode | Chemin | Permission | HTTP | Description |
|---|---|---|---|---|
| POST | `/workflows/start` | `workflows.write` | 201 | Démarrer un workflow sur un objet cible |
| POST | `/workflows/:instanceId/transition` | `workflows.write` | 200 | Appliquer une transition d'état |
| GET | `/workflows/:instanceId/history` | `workflows.read` | 200 | Lire l'historique des événements |

### POST `/workflows/start`

```json
{
  "targetType": "import_session",
  "targetId": "<session-uuid>"
}
```

Idempotent — si une instance existe déjà pour ce `(targetType, targetId, orgId)`, retourne l'instance existante sans créer de doublon.

### POST `/workflows/:instanceId/transition`

```json
{
  "toStatus": "in_review",
  "comment": "Fichier vérifié, prêt pour validation"
}
```

Erreurs :
- `WORKFLOW_TRANSITION_INVALID` (422) : transition non autorisée par le graphe
- `WORKFLOW_INSTANCE_NOT_FOUND` (404) : instance absente ou hors tenant
- `WORKFLOW_LOCKED` (409) : tentative de transition depuis `locked`

### GET `/workflows/:instanceId/history`

Retourne les événements `WorkflowEvent` ordonnés `occurredAt ASC` :

```json
[
  {
    "id": "uuid",
    "fromStatus": null,
    "toStatus": "draft",
    "actorId": "user-uuid",
    "comment": null,
    "occurredAt": "2026-05-24T09:00:00Z"
  },
  {
    "id": "uuid",
    "fromStatus": "draft",
    "toStatus": "in_review",
    "actorId": "user-uuid",
    "comment": "Prêt pour revue",
    "occurredAt": "2026-05-24T10:00:00Z"
  }
]
```

---

## Intégration cross-module

### `assertNotLocked`

```typescript
await workflowService.assertNotLocked(orgId, 'import_session', sessionId);
// lève WORKFLOW_LOCKED (409) si current_status = 'locked'
// no-op si aucune instance ou statut différent
```

**Appelé par** (wave 1) :
- `ImportSessionService.uploadFile` — avant tout upload
- `ImportSessionService.parseFile` — avant tout parse
- `ImportSessionService.commitSession` — avant tout commit

**Engagement wave 2** : `JournalsService.updateEntry` appellera `assertNotLocked` sur l'écriture cible avant modification.

---

## Exemples curl

```bash
BASE="https://backend-production-44c2.up.railway.app"
TOKEN="<scoped-access-token>"

# Démarrer un workflow
curl -sX POST "$BASE/workflows/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetType":"import_session","targetId":"<session-uuid>"}'

# Transition draft → in_review
curl -sX POST "$BASE/workflows/<instance-uuid>/transition" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"toStatus":"in_review","comment":"Session prête pour revue"}'

# Historique
curl -s "$BASE/workflows/<instance-uuid>/history" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Codes d'erreur

| Code | HTTP | Déclencheur |
|---|---|---|
| `WORKFLOW_INSTANCE_NOT_FOUND` | 404 | Instance absente ou hors tenant |
| `WORKFLOW_TRANSITION_INVALID` | 422 | Transition non autorisée par le graphe d'états |
| `WORKFLOW_LOCKED` | 409 | Objet en état `locked` — `assertNotLocked` a levé l'exception |

---

## Modèle de données

### `workflow_definitions`

Définit les types de workflows disponibles. Seedée en migration avec `import_session`.

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `name` | varchar | Nom lisible |
| `target_type` | varchar | `import_session` (extensible) |
| `is_active` | boolean | Seules les définitions actives peuvent être instanciées |

### `workflow_instances`

Une instance = un objet cible dans un état courant.

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `workflow_definition_id` | UUID FK | RESTRICT — la définition ne peut pas être supprimée si des instances existent |
| `organization_id` | UUID FK | CASCADE — isolation tenant |
| `target_type` | varchar | Denormalisé pour les requêtes sans JOIN definition |
| `target_id` | UUID | ID de l'objet cible |
| `current_status` | varchar | État courant (`draft` \| `in_review` \| `approved` \| `locked`) |

### `workflow_events`

Log append-only de chaque transition. Jamais mis à jour ni supprimé.

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `workflow_instance_id` | UUID FK | CASCADE |
| `from_status` | varchar nullable | `null` pour l'événement initial |
| `to_status` | varchar | Nouvel état |
| `actor_id` | UUID nullable | Auteur de la transition |
| `comment` | text nullable | Commentaire libre |
| `occurred_at` | timestamptz | Horodatage de l'événement |

---

## Invariants de conception

**D1 — Séparation définition / instance** : `workflow_definitions` est un catalogue global (non tenant-scopé) ; `workflow_instances` est tenant-scopé. Une définition peut avoir N instances sur N organisations différentes.

**D2 — `assertNotLocked` est contractuel** : tout module métier qui mute un objet cible DOIT appeler `assertNotLocked` avant la mutation. L'oubli est un bug de sécurité fonctionnelle.

**D3 — Events append-only** : `workflow_events` n'a pas de `DELETE` ni `UPDATE`. Le log est immuable et sert de source de vérité pour l'audit trail.

**D4 — Isolation tenant** : `findById(instanceId, orgId)` filtre toujours sur `organization_id` — un appel cross-tenant retourne `WORKFLOW_INSTANCE_NOT_FOUND` (fail-closed).
