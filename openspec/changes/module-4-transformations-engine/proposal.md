## Why

Le Module 3 (imports) a livré la chaîne d'ingestion : sessions, parsing CSV/XLSX/Sage, mapping, validation, persistance en table de staging (`import_staging_entries`). À ce stade, le cabinet a vu ses lignes brutes telles que la banque ou le client les a fournies — mais avant de pousser ces écritures vers les journaux comptables réels (Module 4 journaux/entries, en cours), le comptable doit pouvoir **retraiter** chaque ligne : reclasser un compte mal codé (4111 → 6061), ajouter une régularisation de fin de période (ajustement débit / crédit), corriger un libellé, sans jamais réécrire la ligne d'origine. Sans cette couche, soit on perd la trace de la donnée bancaire brute (rewrite destructif, audit impossible), soit on attend la création des écritures finales pour corriger (trop tard, l'écriture comptable est déjà figée).

Le présent module pose la couche de **retraitement comptable** entre staging et journaux : invariant fondamental, l'écriture source reste immuable. Chaque retraitement est un artefact additionnel (`entry_transformations`), tracé, auditable, soft-deletable (status `cancelled` pour undo/redo en vague 2). Le commit final vers les journaux comptables réels (Module 4 wave 2) consommera la chaîne « source + transformations actives » pour produire les écritures définitives, en respectant la traçabilité exigée par le référentiel OHADA et les missions de commissariat aux comptes.

## What Changes

- Introduction de la capacité **`transformations`** : entité `EntryTransformation` (FK org + source_entry + actor) avec colonnes `type` (`reclassification | adjustment | correction | ventilation | grouping`), `status` (`active | cancelled`), `before_values` / `after_values` (JSONB sparse), `notes`, et traçabilité actor + timestamps. Soft-delete via `status = cancelled` + `cancelled_at` / `cancelled_by_id` / `cancel_reason`. Les écritures sources (`import_staging_entries`) ne sont JAMAIS modifiées.
- Ajout de **2 migrations** : `0033_create_entry_transformations` (table + 3 index composites + 3 CHECK constraints), `0034_add_transformations_permissions` (permissions RBAC).
- Ajout de **2 permissions** dans la matrice RBAC : `transformations.read` (tous rôles métier — admin / expert_comptable / chef_mission / comptable / auditeur, pour traçabilité) et `transformations.write` (autorité comptable opérationnelle — admin / expert_comptable / chef_mission / comptable ; auditeur exclu car il ne crée jamais de données).
- 3 nouveaux codes d'erreur (`TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` → 404, `TRANSFORMATION_NO_FIELD_CHANGED` → 422, `TRANSFORMATION_ADJUSTMENT_INVALID` → 422).
- 3 nouveaux endpoints HTTP sous `/organizations/:id/transformations/*` (POST `/reclassify`, POST `/adjust`, GET `/entries/:entryId/history`), guard chain identique aux Modules 2/3 (`JwtAuthGuard + TenantGuard + PermissionsGuard`).
- 2 nouvelles actions audit côté `AuditTrailService` (module `transformations`) : `entry_reclassified`, `entry_adjusted`. Le service est swallow-and-warn — une panne audit ne bloque jamais la transformation.

## Capabilities

### New Capabilities
- `transformations` : moteur de retraitement comptable. Reclassement et ajustement en vague 1 ; correction libellé/date, ventilation multi-comptes, grouping multi-écritures en vague 2 (types déjà au catalogue). Soft-delete + historique chronologique par écriture source.

### Modified Capabilities
- `rbac` : extension de la matrice avec 2 permissions (`transformations.{read,write}`). Pas de nouveau rôle.

## Impact

- **Backend (NestJS)** : 1 nouveau module `TransformationsModule` branché dans `AppModule` ; 1 entité TypeORM ; 1 repository tenant-scopé ; 1 service `TransformationService` (exporté pour consommation par Module 4 journaux/entries en vague 2) ; 1 controller HTTP ; 2 DTOs class-validator.
- **Base de données** : 1 nouvelle table (`entry_transformations`) avec 3 index composites (`org_source`, `org_type_status`, `org_created_at DESC`) et 3 CHECK constraints (type, status, cohérence `status=cancelled` ↔ `cancelled_at IS NOT NULL`). Aucune modification aux tables Module 1/2/3.
- **Sécurité** : l'invariant d'immuabilité des sources protège l'audit trail comptable. Tenant isolation enforced via JOIN sur `import_sessions.organization_id` (les staging entries n'ont pas d'`organization_id` direct). Cross-tenant access → 404 fail-closed (ne divulgue pas l'existence d'une écriture dans un autre tenant).
- **Dépendances** : aucune nouvelle dépendance npm.
- **Module 4 journaux/entries (wave 2)** : consommera `TransformationService` exporté pour appliquer la chaîne source + transformations actives au moment du commit vers les écritures comptables réelles.
- **Module 7 (audit)** : 2 nouvelles actions du module `transformations` au catalogue, sans changement de schéma `audit_logs`.
