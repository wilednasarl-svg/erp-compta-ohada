## Why

Le Module 3 (imports) ingère des centaines de lignes brutes par session ; le Module 4 (transformations) permet de retraiter chaque ligne à la main. Mais en cabinet OHADA, les mêmes décisions de retraitement reviennent en boucle : « toute charge bancaire `62xx` du journal `BQ` part sur le centre de coûts `ADMIN` », « toute écriture libellée `IMPOTS` sur le journal `OD` est reclassée en `447` », « tout règlement supérieur à 5 M XOF déclenche une alerte de relecture ». Sans automatisation, le comptable refait cliquer-à-cliquer le même retraitement sur des dizaines de lignes par mois — c'est le deuxième frein opérationnel après l'ingestion elle-même.

Le Module 5 pose un **moteur de règles** : chaque règle encode une intention `SI conditions ALORS actions` stockée en JSONB (extensible sans migration), évaluable en simulation (preview du plan sans écriture) ou en application (création réelle des transformations via Module 4). Chaque exécution est journalisée dans `rule_executions` avec snapshot des matches — auditeur et expert-comptable peuvent expliquer **rétroactivement** ce qu'une règle a fait et sur quel périmètre.

## What Changes

- Introduction de la capacité **`rules`** : entité `Rule` (FK org + créateur + updater) avec `name`, `description`, `isActive`, `priority` (ordre d'évaluation — bas = premier), `conditions` (JSONB array, union typée TS), `actions` (JSONB array, union typée TS). 6 types de conditions (`account_prefix`, `account_in`, `journal_in`, `amount_range`, `label_contains`, `date_range`) et 4 types d'actions (`reclassify_account`, `reclassify_journal`, `assign_cost_center`, `add_tag`). Validation côté service via whitelist de `type` discriminants.
- Introduction de l'entité **`RuleExecution`** : journal append-only des exécutions avec `mode` (`simulation` | `apply`), `scope` (JSONB — journal, dateFrom/dateTo, importSessionId), `matchedCount`, `appliedCount`, `transformationIds` (UUIDs des `entry_transformations` créées), `matchesSnapshot` (capture des actions appliquées par entry), `error` (nullable — string d'erreur si apply partiel), `executedById`. CHECK `applied_count <= matched_count` côté DB.
- Ajout de **3 migrations** : `0025_create_rules`, `0026_create_rule_executions`, `0027_add_rules_permissions`.
- Ajout de **4 permissions** dans la matrice RBAC : `rules.read` (lecture règles + historique d'exécution), `rules.write` (CRUD règles), `rules.simulate` (preview sans side-effect), `rules.apply` (exécution réelle — crée des transformations). La séparation `simulate` / `apply` permet d'autoriser un `comptable` à tester une règle sans pouvoir l'appliquer en production (réservée aux rôles seniors `admin`, `expert_comptable`, `chef_mission`).
- Ajout de **3 codes d'erreur** : `RULE_NOT_FOUND` (404), `RULE_INVALID_CONDITION` (422 — `type` de condition inconnu), `RULE_INVALID_ACTION` (422 — `type` d'action inconnu ou liste vide). Tous mappés dans `HTTP_STATUS_MAP`.
- 7 nouveaux endpoints HTTP sous `/organizations/:id/rules/*` : `POST` (créer), `GET` (lister), `GET :id` (détail), `PATCH :id` (update), `POST :id/simulate` (preview), `POST :id/apply` (apply), `GET :id/executions` (historique). Guard chain identique aux modules précédents (`JwtAuthGuard + TenantGuard + PermissionsGuard`).
- 3 nouveaux types d'événements d'audit côté `AuditTrailService` (module `rules`) : `rule_created`, `rule_updated`, `rule_simulated`, `rule_applied`. Le service est swallow-and-warn — une panne audit ne bloque jamais une exécution.

## Capabilities

### New Capabilities
- `rules` : moteur d'automatisation des retraitements comptables. CRUD règles, simulation (dry-run sans écriture), application (crée des transformations Module 4), historique d'exécution. Les écritures sources (`import_staging_entries`) ne sont **jamais** modifiées directement — toute modification passe par `TransformationService`.

### Modified Capabilities
- `rbac` : extension de la matrice avec 4 permissions (`rules.{read,write,simulate,apply}`). Pas de nouveau rôle.

## Impact

- **Backend (NestJS)** : 1 nouveau module `RulesModule` branché dans `AppModule` ; 2 entités TypeORM ; 2 repositories tenant-scopés ; 2 services (`RulesService` pour le CRUD, `RuleEngineService` pour evaluate/simulate/apply) ; 1 controller HTTP ; 3 DTOs class-validator.
- **Base de données** : 2 nouvelles tables (`rules`, `rule_executions`) avec 5 index composites au total et 4 CHECK constraints (priority ≥ 0, name non vide, mode IN simulation/apply, applied_count ≤ matched_count). Aucune modification aux tables Modules 1-4.
- **Dépendance Module 4 (transformations)** : `RuleEngineService.applyRules` délègue chaque action à `TransformationService.reclassifyEntry` — un retraitement automatique est indistinguable d'un retraitement manuel côté `entry_transformations` (même schéma, même soft-delete, même audit). La traçabilité spécifique « cette transformation vient d'une règle » est portée par `rule_executions.transformationIds` (jointure inverse) et le champ `notes` de chaque transformation (préfixé `Règle automatique: <ruleName>`).
- **Sécurité** : tenant isolation enforced via repositories (`assertTenantId` partout) et via JOIN sur `import_sessions.organization_id` lors du fetch des entries (les staging entries n'ont pas d'`organization_id` direct). Cross-tenant access → 404 fail-closed. L'invariant d'immuabilité des sources est préservé (le moteur n'écrit jamais sur `import_staging_entries`).
- **Dépendances** : aucune nouvelle dépendance npm.
- **Module 7 (audit)** : 4 nouvelles actions `rules.*` consommées via `AuditTrailService.record(...)` — le module union `AuditModule` inclut déjà `rules`.
- **Frontend (Next.js 15)** : hors scope. UI de gestion des règles + dashboard d'exécutions arrivera dans `module-5b-rules-frontend`.
