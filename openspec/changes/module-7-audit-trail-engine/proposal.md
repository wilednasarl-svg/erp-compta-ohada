## Why

Le Module 1 a livré `auth_events` — un journal append-only ciblé sur les événements d'authentification (`auth.login_success`, `organizations.role_changed`, etc.). Module 2 et 3 ont ensuite émis des dizaines de nouveaux types d'événements (`chart_of_accounts.account_created`, `imports.file_uploaded`, `documents.uploaded`, …) qui n'avaient plus rien d'« auth » : ils décrivent toutes les actions modifiant l'état métier. La table et son service portaient un nom incorrect, et surtout, le shape `{ event_type, metadata: jsonb }` ne capturait ni les diffs (`before` / `after`), ni l'entité ciblée (`entity_type` / `entity_id`), ni le module émetteur. Sans ces colonnes, impossible de répondre proprement aux exigences traçabilité d'un cabinet OHADA : « qui a changé le libellé du compte 411 d'Acme Ltd le 12 avril, depuis quelle IP, et avec quelle valeur précédente ? ».

Le Module 7 transforme `auth_events` en **`audit_logs`** — table de journal d'audit générique, partagée par tous les modules, exposant un service unifié `AuditTrailService` que chaque feature module appelle pour enregistrer ses changements. La vue back-compat `auth_events` est préservée pour les consommateurs Module 1 (notamment `AuthEventsController` et les tests e2e existants).

## What Changes

- **Renomme** la table `auth_events` en `audit_logs` (migration 0019) et étend son schéma : `module` (string union), `action`, `entity_type`, `entity_id`, `before` (JSONB), `after` (JSONB). `event_type` est conservé comme colonne compound (`${module}.${action}`) pour back-compat.
- Crée une **vue Postgres `auth_events`** sur `audit_logs` filtrant les modules d'auth (`module IN ('auth', 'organizations', 'rbac')`) pour que `AuthEventRepository` du Module 1 continue à fonctionner sans changement.
- Introduit le service unifié **`AuditTrailService`** avec une API `record({ module, action, entityType?, entityId?, before?, after?, context })` que tout module métier appelle.
- Ajoute l'endpoint **`GET /audit/logs`** (multi-tenant, filtrable par `module`, `action`, `entityId`, `userId`, `dateFrom`, `dateTo`, paginé) — réservé aux rôles avec `audit.read` (`admin`, `expert_comptable`, `chef_mission`, `auditeur`).
- Étend `AuditModule` type union avec les modules connus : `auth`, `organizations`, `rbac`, `chart_of_accounts`, `accounting`, `imports`, `transformations`, `rules`, `workflows`, `reports`, `documents`, `ai`, `_legacy`.
- **Aucune nouvelle permission** : `audit.read` et `audit.export` existent depuis Module 1 (migration 0005) et restent les seuls codes pertinents.

## Capabilities

### New Capabilities
- `audit` : journal de bord unifié de toutes les actions modifiant l'état métier. Append-only au niveau API (aucun endpoint d'`UPDATE` ou `DELETE`). Couvre auth + organisations + RBAC + plan comptable + imports + documents (+ futurs modules) via un même schéma.

### Modified Capabilities
- `auth` : la table `auth_events` devient une **vue** sur `audit_logs`. Le repository et le service du Module 1 (`AuthEventRepository`, `AuthEventsService`) continuent à publier dans les modules `auth` / `organizations` / `rbac` — leurs consommateurs lisent maintenant via la vue. Aucun changement d'API publique.

## Impact

- **Backend (NestJS)** : 1 nouvelle entité `AuditLogEntity` + repository `AuditLogRepository` + service `AuditTrailService` + controller `AuditLogsController` + DTO `ListAuditLogsQueryDto`. `AuthEventEntity` conservé comme projection.
- **Base de données** : 1 migration `0019_extend_auth_events_to_audit_logs.ts` qui :
  1. Renomme `auth_events` → `audit_logs` ;
  2. Ajoute les 5 colonnes (`module`, `action`, `entity_type`, `entity_id`, `before`, `after`) ;
  3. Crée une vue `auth_events` sur le sous-ensemble auth + orgs + rbac pour Module 1 back-compat ;
  4. Ajoute index composite `(organization_id, module, created_at DESC)` et `(organization_id, module, action, created_at DESC)` — les deux requêtes dominantes du dashboard d'audit.
- **Modules existants** : `OrganizationsService`, `ChartOfAccountsService`, `ImportSessionService`, `DocumentsService` migrent progressivement de `AuthEventsService.record(...)` vers `AuditTrailService.record(...)` — l'ancienne API reste pour back-compat tant que tous les call-sites ne sont pas convertis (issue beads de suivi).
- **Sécurité** : append-only enforced par l'absence d'endpoints write/update — la migration n'expose AUCUN endpoint mutateur. La lecture via `GET /audit/logs` est tenant-scoped + permission-gated (`audit.read`).
- **Dépendances** : aucune nouvelle dépendance npm.
