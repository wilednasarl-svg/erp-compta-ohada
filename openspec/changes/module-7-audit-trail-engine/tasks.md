## 1. Migration schéma

- [x] 1.1 Migration `0019_extend_auth_events_to_audit_logs.ts` :
  - `ALTER TABLE auth_events RENAME TO audit_logs`
  - `ALTER TABLE audit_logs ADD COLUMN module TEXT NOT NULL DEFAULT '_legacy'`
  - `ALTER TABLE audit_logs ADD COLUMN action TEXT NOT NULL DEFAULT 'legacy'`
  - `ALTER TABLE audit_logs ADD COLUMN entity_type TEXT NULL`
  - `ALTER TABLE audit_logs ADD COLUMN entity_id UUID NULL`
  - `ALTER TABLE audit_logs ADD COLUMN before JSONB NULL`
  - `ALTER TABLE audit_logs ADD COLUMN after JSONB NULL`
  - backfill `module` / `action` depuis `event_type` (split sur premier `.`)
  - `CREATE VIEW auth_events AS SELECT * FROM audit_logs WHERE module IN ('auth','organizations','rbac')`
- [x] 1.2 Indexes composites
  - `(organization_id, module, created_at DESC)` — dashboard "events for org X by module"
  - `(organization_id, module, action, created_at DESC)` — drill-down par type d'action
  - `(entity_id)` partial sur `entity_id IS NOT NULL` — recherche par entité
- [x] 1.3 Vue back-compat `auth_events` testée par les tests e2e Module 1 (deny-by-default, refresh-token-reuse, mfa-activation, etc. doivent continuer à passer)

## 2. Type catalogue

- [x] 2.1 `AuditModule` string union dans `audit-log.entity.ts` — 13 valeurs (auth, organizations, rbac, chart_of_accounts, accounting, imports, transformations, rules, workflows, reports, documents, ai, _legacy)
- [x] 2.2 `AuthEventType` union du Module 1 reste utilisable (back-compat via la vue)

## 3. Entité TypeORM

- [x] 3.1 `AuditLogEntity` avec 2 `@Index` composite (org+module+createdAt, org+module+action+createdAt)
- [x] 3.2 Champs JSONB `before` / `after` typés `Record<string, unknown> | null`
- [x] 3.3 Champs `entity_type` / `entity_id` nullable

## 4. Repository

- [x] 4.1 `AuditLogRepository` tenant-scopé (assertTenantId sur les reads)
- [x] 4.2 Méthodes `record(input)`, `listForOrganization(orgId, filters, pagination)`, `findById(id, orgId)`
- [x] 4.3 Pas de méthode `update`, `delete` exposée (append-only API)

## 5. Service unifié

- [x] 5.1 `AuditTrailService.record({ module, action, entityType?, entityId?, before?, after?, context })` —
  émet une ligne dans `audit_logs`, calcule `event_type = module + '.' + action` pour back-compat
- [x] 5.2 `AuditTrailService.list(orgId, filters, pagination)` — délégué au repo
- [x] 5.3 Tests unitaires : happy path record + listing par module + filtrage par entity_id

## 6. Controller HTTP

- [x] 6.1 `AuditLogsController` `GET /audit/logs` avec query params `module`, `action`, `entityId`, `userId`, `dateFrom`, `dateTo`, `page`, `pageSize`
- [x] 6.2 `@RequirePermission('audit.read')` — admin / expert_comptable / chef_mission / auditeur
- [x] 6.3 `@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)` — tenant-scoped lecture
- [x] 6.4 Test unitaire controller (delegation au service, validation query params)

## 7. Migration progressive des call-sites Module 1-3

- [x] 7.1 `OrganizationsService.create` → utilise `AuditTrailService` pour `organizations.created`
- [x] 7.2 `ChartOfAccountsService` → utilise `AuditTrailService` pour les 4 events `chart_of_accounts.*`
- [x] 7.3 `ImportSessionService` → utilise `AuditTrailService` pour les 4 events `imports.*`
- [x] 7.4 `DocumentsService` → utilise `AuditTrailService` pour `documents.uploaded` / `.deleted`
- [ ] 7.5 `AuthService` / Module 1 — encore sur `AuthEventsService`. Pas un blocker (la vue
  `auth_events` mappe vers `audit_logs`) mais à migrer pour cohérence — issue suivi.

## 8. Documentation

- [ ] 8.1 `docs/audit.md` : table unifiée, modèle (module/action/entity), exemples de queries
- [ ] 8.2 Mettre à jour `docs/rbac.md` mention `audit.read` couvre maintenant `/audit/logs` aussi (pas seulement `/organizations/:id/auth-events`)
- [ ] 8.3 README backend : mentionner la migration 0019 et le service unifié

## 9. Pre-merge checks

- [x] 9.1 `pnpm --filter backend test` passe (412/412 actuel)
- [x] 9.2 `pnpm --filter backend typecheck` propre
- [ ] 9.3 Validation OpenSpec `openspec validate --changes` → ce change valide
- [ ] 9.4 Audit `security-reviewer` agent (focus : append-only enforcement, tenant isolation sur GET /audit/logs, pas de leak entity_id cross-tenant)
- [ ] 9.5 Audit `code-reviewer` agent (focus : signature AuditTrailService stable, cohérence des call-sites Module 1-3)
