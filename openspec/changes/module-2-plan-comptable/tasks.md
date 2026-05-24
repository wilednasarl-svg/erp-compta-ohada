## 1. Seed du plan comptable de référence OHADA AUDCIF

- [x] 1.1 Créer `apps/backend/src/modules/accounting-plan/seed/ohada-syscohada-audcif.ts` : tableau TS exhaustif `{ code, label, class, account_type, normal_balance, applicable_systems }[]` pour le Système Normal (~800 entrées, classes 1–9)
- [x] 1.2 Compléter le seed pour le Système Allégé (~600 entrées, sous-ensemble du Normal)
- [x] 1.3 Compléter le seed pour le Système Minimal de Trésorerie (~400 entrées, focus classes 5/6/7)
- [x] 1.4 Test unitaire `seed.spec.ts` : pas de doublon de `code`, chaque code matche `/^\d{2,10}$/`, `class` cohérent avec le premier chiffre du code, `normal_balance` ∈ {D,C}, au moins un `applicable_systems` par ligne

## 2. Migrations base de données

- [x] 2.1 Migration `0011_create_reference_chart_accounts.ts` : crée la table + indexes (UNIQUE code, INDEX class, INDEX GIN applicable_systems) + insère les ~800 lignes du seed via `queryRunner.manager.insert()` en batches de 100
- [x] 2.2 Migration `0012_create_organization_accounting_configs.ts` : crée la table 1-1 avec `organizations` (PK = organization_id, FK CASCADE, CHECK system IN ('NORMAL','MINIMAL','ALLEGE'))
- [x] 2.3 Migration `0013_create_organization_chart_accounts.ts` : crée la table + indexes composites + FK self-referencing parent_id (ON DELETE RESTRICT) + UNIQUE(organization_id, code)
- [x] 2.4 Migration `0014_add_chart_of_accounts_permissions.ts` : insère les 2 permissions (`chart_of_accounts.read`, `chart_of_accounts.write`) + assignations dans `role_permissions` selon la matrice D6 du design (ON CONFLICT DO NOTHING)
- [x] 2.5 Vérifier que chaque migration up/down est symétrique et idempotente (CREATE EXTENSION IF NOT EXISTS pour pgcrypto si besoin)

## 3. Entités TypeORM

- [x] 3.1 `ReferenceAccountEntity` (table `reference_chart_accounts`, immuable côté code applicatif)
- [x] 3.2 `OrganizationAccountEntity` (table `organization_chart_accounts`, avec relation self `@ManyToOne(() => OrganizationAccountEntity) parent` et `@OneToMany(...) children`)
- [x] 3.3 `OrganizationAccountingConfigEntity` (1-1 avec OrganizationEntity, type `enum AccountingSystem { NORMAL, MINIMAL, ALLEGE }`)
- [x] 3.4 Étendre `OrganizationEntity` du Module 1 avec `@OneToOne(() => OrganizationAccountingConfigEntity)` côté JoinColumn dans la config

## 4. Repositories

- [x] 4.1 `ReferenceAccountRepository` : `listBySystem(system)`, `findByCode(code)` (read-only)
- [x] 4.2 `OrganizationAccountRepository` : tenant-scopé (paramètre `TenantId` obligatoire), méthodes `listByOrganization`, `findByCode`, `findById`, `create`, `update`, `delete`, `countChildren`, `existsAnyByCodePrefix`
- [x] 4.3 `OrganizationAccountingConfigRepository` : `findByOrganizationId`, `create` (en transaction avec org)
- [x] 4.4 Tests unitaires repositories : invariant `assertTenantId` enforcé, requêtes filtrent toujours sur `organization_id`

## 5. Service `ReferenceChartService`

- [x] 5.1 `listBySystem(system: AccountingSystem): Promise<ReferenceAccountView[]>` — retourne le plan officiel filtré par système, ordonné par code
- [x] 5.2 Test unitaire : compte exact de comptes par système (Normal/Minimal/Allégé), tri par code croissant

## 6. Service `ChartOfAccountsService`

- [x] 6.1 `cloneReferenceIntoOrganization(orgId, system, txManager?)` — clone toutes les lignes de référence applicables au système en `organization_chart_accounts` ; matérialise `parent_id` en deux passes (insert sans parent, puis update `parent_id` par lookup préfixe) ; idempotent (ON CONFLICT skip)
- [x] 6.2 `listForOrganization(orgId, { activeOnly?, classFilter? }): Promise<AccountView[]>` — retourne l'arbre aplati ordonné par code
- [x] 6.3 `getAccount(orgId, accountId): Promise<AccountView>` — 404 si pas trouvé / cross-tenant
- [x] 6.4 `createCustomAccount(orgId, { parentCode, code, label, accountType, normalBalance }, actorId, ctx)` — valide : parent existe et actif, code commence par parent.code, code.length > parent.code.length, code unique dans l'org ; promeut le parent en TITLE si nécessaire ; émet `chart_of_accounts.account_created`
- [x] 6.5 `updateAccount(orgId, accountId, { label?, isActive? }, actorId, ctx)` — interdit modification du code ; émet `chart_of_accounts.account_updated` ou `chart_of_accounts.account_deactivated`
- [x] 6.6 `deleteAccount(orgId, accountId, actorId, ctx)` — autorise uniquement si `reference_account_id IS NULL` (compte custom) ET aucun enfant actif ; sinon `CHART_ACCOUNT_NOT_DELETABLE` (409)
- [x] 6.7 Tests unitaires : tous les invariants (préfixe parent, code unique, code immutable, suppression refusée si enfants ou si compte de référence)

## 7. Controllers + DTOs

- [ ] 7.1 `ReferenceChartController` : `GET /reference-chart-of-accounts?system=…` (public, `@Public()` opt-out du JwtAuthGuard global)
- [ ] 7.2 `ChartOfAccountsController` : 5 endpoints sous `/organizations/:id/chart-of-accounts` avec `@RequirePermission('chart_of_accounts.read'|'.write')`
- [ ] 7.3 DTOs class-validator : `CreateAccountDto` (parentCode, code, label), `UpdateAccountDto` (label?, isActive?), `ImportChartDto` (no body, just trigger)
- [ ] 7.4 `@ApiTags('ChartOfAccounts')` + `@ApiBearerAuth('bearer')` sur tous les endpoints non-publics ; documentation Swagger générée automatiquement

## 8. Intégration avec Module 1

- [ ] 8.1 Étendre `CreateOrganizationDto` avec `system: 'NORMAL'|'MINIMAL'|'ALLEGE'` (obligatoire, validé par class-validator `IsIn`)
- [ ] 8.2 Modifier `OrganizationsService.create()` pour qu'à la création de l'org, en une seule transaction : insert org → insert accounting config → call `ChartOfAccountsService.cloneReferenceIntoOrganization()` → émet `chart_of_accounts.imported`
- [ ] 8.3 Ajouter le champ "système comptable" au wizard `/organizations/new` du frontend (étape 2)
- [ ] 8.4 Migration des orgs existantes (le seed dev + tout cabinet déjà créé en pré-prod) : commande `pnpm seed:fix-accounting-configs` qui détecte les orgs sans config et leur applique `NORMAL` par défaut + clone

## 9. Frontend Next.js

- [ ] 9.1 Page `/organizations/:id/chart-of-accounts` : arbre hiérarchique (composant `<AccountTree>`), recherche par code/libellé, indicateur TITLE vs POSTING
- [ ] 9.2 Modal "Ajouter un sous-compte" sous un compte sélectionné, formulaire react-hook-form + zod
- [ ] 9.3 Modal "Modifier" : édition label + toggle actif (code en lecture seule)
- [ ] 9.4 Action "Supprimer" avec confirmation, gère le 409 `CHART_ACCOUNT_NOT_DELETABLE`
- [ ] 9.5 Tour gratuit du plan de référence avant choix (lien dans le wizard d'org) via `GET /reference-chart-of-accounts?system=…`
- [ ] 9.6 Lien dans la sidebar AppShell : "Plan comptable" (uniquement si `chart_of_accounts.read`)

## 10. Tests d'intégration (e2e)

- [ ] 10.1 `chart-of-accounts-clone.e2e-spec.ts` : POST /organizations avec system=NORMAL → vérifie que ~800 lignes sont créées dans `organization_chart_accounts`
- [ ] 10.2 `chart-of-accounts-tenant-isolation.e2e-spec.ts` : org A ne peut ni lire ni modifier les comptes de l'org B (404, pas 403)
- [ ] 10.3 `chart-of-accounts-permissions.e2e-spec.ts` : Auditeur peut lire mais pas écrire (403 sur POST/PATCH/DELETE)
- [ ] 10.4 `chart-of-accounts-invariants.e2e-spec.ts` : code immutable (PATCH avec `code` ignoré ou 422), code doit préfixer parent (422), code dupliqué dans org (409)
- [ ] 10.5 `chart-of-accounts-deletion.e2e-spec.ts` : compte de référence indélétable (409), compte custom avec enfants indélétable (409), compte custom feuille délétable (204)
- [ ] 10.6 Coverage backend ≥ 80 % maintenu

## 11. Documentation

- [ ] 11.1 `docs/accounting-plan.md` : structure SYSCOHADA AUDCIF, choix du système, distinction TITLE/POSTING, exemples d'ajout custom
- [ ] 11.2 Mettre à jour `docs/rbac.md` avec les 2 nouvelles permissions et la matrice rôle × `chart_of_accounts.*`
- [ ] 11.3 Mettre à jour `docs/error-codes.md` avec : `CHART_ACCOUNT_NOT_FOUND` (404), `CHART_ACCOUNT_CODE_TAKEN` (409), `CHART_ACCOUNT_INVALID_PARENT` (422), `CHART_ACCOUNT_INVALID_CODE` (422), `CHART_ACCOUNT_NOT_DELETABLE` (409), `CHART_ACCOUNT_IMMUTABLE_CODE` (422), `ACCOUNTING_SYSTEM_REQUIRED` (422)
- [ ] 11.4 README backend : mentionner la commande de migration `0011..0014` et le seed du plan de référence

## 12. Pre-merge checks

- [ ] 12.1 `pnpm --filter backend test` passe avec coverage ≥ 80 %
- [ ] 12.2 `pnpm lint` et `pnpm build` propres backend + frontend
- [ ] 12.3 Validation OpenSpec : `openspec status --change module-2-plan-comptable` → `isComplete: true`
- [ ] 12.4 Revue par `security-reviewer` agent (focus : tenant isolation sur les nouveaux endpoints, immuabilité du plan de référence)
- [ ] 12.5 Revue par `code-reviewer` agent (focus : invariants comptables, transactionnalité du clone)
