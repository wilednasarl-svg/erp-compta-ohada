## Why

Les Modules 1-3 ont livré l'auth, le plan comptable et le moteur d'import. La session d'import (Module 3) franchit aujourd'hui une machine à états technique (`draft → parsing → parsed → validated → ready_for_import → completed | failed`) qui ne reflète QUE le parcours de parsing — pas la **gouvernance métier** d'un cabinet OHADA : « qui a relu ces écritures ? qui les a validées ? sont-elles verrouillées pour l'exercice clos ? ».

Le Module 6 introduit un **moteur de workflow générique multi-cibles** qui superpose à ces objets métier un cycle de validation à 4 états : `draft → in_review → approved → locked`. La cible de la vague 1 est `import_session` (un cabinet peut désormais soumettre une session à revue puis la verrouiller). La vague 2 étendra `WorkflowTargetType` à `journal_entry` (Module 4) et `report` (Module 5) sans changer le schéma — seule la string union TypeScript bouge. L'état `locked` est un invariant fort : `WorkflowService.assertNotLocked(targetType, targetId)` est exporté pour que les modules consommateurs (notamment Module 4 écritures) refusent toute mutation d'un objet verrouillé.

## What Changes

- Introduction de la capacité **`workflows`** : 3 tables (`workflow_definitions` catalogue, `workflow_instances` état courant, `workflow_events` journal append-only des transitions). Une seule définition active en vague 1 (`import_session`).
- Machine d'états à 4 valeurs : `draft → in_review → approved → locked`. Retours autorisés : `in_review → draft`, `approved → in_review`. L'état `locked` est terminal — aucune transition sortante.
- Service unique **`WorkflowService`** exposant `startWorkflow`, `transition`, `getHistory`, et l'invariant partagé `assertNotLocked` (consommé hors-module).
- 3 endpoints HTTP sous `/workflows` : `POST /workflows/start`, `POST /workflows/:instanceId/transition`, `GET /workflows/:instanceId/history`. Guard chain habituelle (`JwtAuthGuard + TenantGuard + PermissionsGuard`).
- 3 nouvelles permissions RBAC : `workflows.read` (tous rôles métier), `workflows.write` (jusqu'à `comptable`), `workflows.approve` (admin / expert / chef_mission uniquement — pas le `comptable` qui soumet sans valider).
- 4 migrations : `0028 workflow_definitions`, `0029 workflow_instances`, `0030 workflow_events`, `0031 seed workflow permissions + définition import_session`.
- 3 nouveaux codes d'erreur : `WORKFLOW_INSTANCE_NOT_FOUND` (404), `WORKFLOW_TRANSITION_INVALID` (422), `WORKFLOW_LOCKED` (409).
- Intégration audit : toutes les transitions sont journalisées via `AuditTrailService.record({ module: 'workflows', action: 'started' | 'transition', ... })` (le module `workflows` est déjà dans le type union `AuditModule` du Module 7).

## Capabilities

### New Capabilities
- `workflows` : moteur de validation multi-niveaux générique, multi-cibles. Vague 1 cible `import_session` ; la vague 2 ajoutera `journal_entry` (Module 4) et `report` (Module 5) par simple extension du type `WorkflowTargetType`. L'état `locked` est partagé comme invariant fort — `WorkflowService.assertNotLocked` est exporté pour bloquer toute mutation cross-module sur un objet verrouillé.

### Modified Capabilities
- `rbac` : extension de la matrice avec 3 permissions (`workflows.{read,write,approve}`). Aucun nouveau rôle.
- `audit` : ajout de `workflows` à l'union `AuditModule` (déjà câblé côté Module 7) et deux actions (`workflows.started`, `workflows.transition`).

## Impact

- **Backend (NestJS)** : 1 nouveau module (`WorkflowsModule`) branché dans `AppModule` et exporté pour réutilisation cross-module ; 3 entités TypeORM ; 3 repositories ; 1 service unifié ; 1 controller HTTP ; 2 DTO class-validator.
- **Base de données** : 3 nouvelles tables + 1 migration de seed permissions/définition. Aucun changement aux tables Modules 1-3 / 7.
- **Module 3 (imports)** : `ImportSessionService` consomme `WorkflowService.assertNotLocked('import_session', sessionId)` avant tout upload/parse/commit. Le couplage est unidirectionnel (imports dépend de workflows, jamais l'inverse).
- **Module 4 (à venir)** : la machine `locked` sera la barrière qui empêche de modifier une écriture appartenant à un exercice clos. Pas de code à écrire dans cette change — juste l'engagement contractuel via la spec.
- **Sécurité** : surface restreinte (3 endpoints, append-only sur `workflow_events`). Pas d'upload, pas d'input libre côté payloads (juste `targetType`, `targetId`, `toStatus`, `comment`). RBAC séparation lecture/écriture/approbation au plus tôt.
- **Dépendances** : aucune nouvelle dépendance npm.
