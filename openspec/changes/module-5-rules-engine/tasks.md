## 1. Schéma base de données

- [x] 1.1 Migration `0025_create_rules.ts` : table `rules` (`id`, `organization_id` FK CASCADE, `name`, `description`, `is_active`, `priority`, `conditions` JSONB, `actions` JSONB, `created_by_id` FK RESTRICT, `updated_by_id` FK RESTRICT, `created_at`, `updated_at`)
- [x] 1.2 Migration `0026_create_rule_executions.ts` : table `rule_executions` (`id`, `organization_id` FK CASCADE, `rule_id` FK CASCADE, `mode` (simulation/apply), `scope` JSONB, `matched_count`, `applied_count`, `transformation_ids` JSONB, `error` nullable, `executed_by_id` FK RESTRICT, `created_at`)
- [x] 1.3 CHECK contraintes : `chk_rules_priority_positive` (priority >= 0), `chk_rules_name_not_empty` (trimmed name length > 0), `chk_rule_executions_mode` (simulation/apply), `chk_rule_executions_counts_positive` (matched and applied counts >= 0), `chk_rule_executions_applied_lte_matched` (applied <= matched)
- [x] 1.4 Indexes composites : `ix_rules_org_active` (org, isActive), `ix_rules_org_priority` (org, priority ASC), `ix_rules_org_created_at` (org, createdAt DESC), `ix_rule_executions_org_rule_created_at` (org, ruleId, createdAt DESC), `ix_rule_executions_org_created_at` (org, createdAt DESC)
- [x] 1.5 Migration `0027_add_rules_permissions.ts` : insert des 4 permissions `rules.{read,write,simulate,apply}` + matrice rôles (admin/expert/chef = read+write+simulate+apply, comptable = read+simulate, auditeur/client_readonly = read seul)

## 2. Types et catalogues

- [x] 2.1 `RuleCondition` union (`account_prefix | account_in | journal_in | amount_range | label_contains | date_range`)
- [x] 2.2 `RuleAction` union (`reclassify_account | assign_cost_center | add_tag | reclassify_journal`)
- [x] 2.3 `RuleScope` shape (journal?, dateFrom?, dateTo?, importSessionId?)
- [x] 2.4 `RuleMatch` shape (entryId, actions, transformationIds)
- [x] 2.5 `RuleExecutionResult` shape (ruleId, mode, matchedCount, appliedCount, matches, error?)
- [x] 2.6 3 codes d'erreur ajoutés à `ERROR_CODES` (`RULE_NOT_FOUND` -> 404, `RULE_INVALID_CONDITION` -> 422, `RULE_INVALID_ACTION` -> 422) + mapping HTTP

## 3. Entités TypeORM

- [x] 3.1 `RuleEntity` (`@Entity rules`, `@Index ix_rules_org_active`, `@Index ix_rules_org_priority`, `@Index ix_rules_org_created_at`, relations `@ManyToOne` vers `OrganizationEntity` et `UserEntity` pour createdBy/updatedBy)
- [x] 3.2 `RuleExecutionEntity` (`@Entity rule_executions`, `@Index ix_rule_executions_org_rule_created_at`, `@Index ix_rule_executions_org_created_at`, relations `@ManyToOne` vers `OrganizationEntity`, `RuleEntity` et `UserEntity` pour executedBy)

## 4. Repositories

- [x] 4.1 `RuleRepository` tenant-scopé (`assertTenantId` sur toutes les méthodes) : `create`, `findById`, `findAll`, `findActive`, `update`
- [x] 4.2 `RuleExecutionRepository` tenant-scopé : `create`, `findByRule` (ordonné par `created_at DESC`), `findAll`

## 5. Services

- [x] 5.1 `RulesService` (CRUD) : `createRule`, `listRules`, `getRule`, `updateRule`, `getExecutionHistory`, avec validation stricte du DSL (`validateRuleDefinition`)
- [x] 5.2 `RuleEngineService` (execution) : `evaluateRuleOnEntry` (pur sans side-effect), `simulateRules`, `applyRules` (crée des transformations via `TransformationService` pour chaque match), `persistExecution` (append-only), `fetchEntries` (JOIN `import_sessions` pour isolation tenant)

## 6. Controller HTTP

- [x] 6.1 `RulesController` (`/organizations/:id/rules`) sous `@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)` + `@ApiTags('rules')` + `@ApiBearerAuth()`
- [x] 6.2 `POST /` — `@RequirePermission('rules.write')`, body `CreateRuleDto`
- [x] 6.3 `GET /` — `@RequirePermission('rules.read')`
- [x] 6.4 `GET /:ruleId` — `@RequirePermission('rules.read')`
- [x] 6.5 `PATCH /:ruleId` — `@RequirePermission('rules.write')`, body `UpdateRuleDto`
- [x] 6.6 `POST /:ruleId/simulate` — `@RequirePermission('rules.simulate')`, body `ExecuteRuleDto`
- [x] 6.7 `POST /:ruleId/apply` — `@RequirePermission('rules.apply')`, body `ExecuteRuleDto`
- [x] 6.8 `GET /:ruleId/executions` — `@RequirePermission('rules.read')`

## 7. DTOs

- [x] 7.1 `CreateRuleDto` class-validator : `name` (string non vide), `description` (string optionnel), `isActive` (boolean optionnel), `priority` (int >= 0), `conditions` (array), `actions` (array)
- [x] 7.2 `UpdateRuleDto` class-validator : champs optionnels de `CreateRuleDto`
- [x] 7.3 `ExecuteRuleDto` class-validator : `scope` (`RuleScope` optionnel)

## 8. Module wiring

- [x] 8.1 `RulesModule` importe `AuthModule`, `RbacModule`, `AuditModule`, `TransformationsModule` (sans dépendance circulaire), `TypeOrmModule.forFeature([RuleEntity, RuleExecutionEntity, ImportStagingEntryEntity])`
- [x] 8.2 Branchement dans `AppModule.imports`

## 9. Audit catalogue

- [x] 9.1 Actions `rule_created`, `rule_updated`, `rule_simulated` et `rule_applied` émises via `AuditTrailService.record({ module: 'rules', action, entityType: 'rule', entityId: ruleId, before?, after?, ctx })`

## 10. Tests unitaires

- [x] 10.1 `rules.service.spec.ts` : CRUD rules + validation de DSL (rejette conditions ou actions inconnues, rejette si aucune action)
- [x] 10.2 `rule-engine.service.spec.ts` : happy path simulation, happy path apply (calls `reclassifyEntry`), matchesCondition correct pour tous les types de conditions (`account_prefix`, `account_in`, `journal_in`, `amount_range`, `label_contains`, `date_range`)

## 11. Tests d'intégration (e2e) — follow-up

- [ ] 11.1 `rules-lifecycle.e2e-spec.ts` : create rule → simulate → apply → get execution history sur le même set d'écritures
- [ ] 11.2 `rules-tenant-isolation.e2e-spec.ts` : org A ne peut pas lire, modifier, simuler ou appliquer les règles d'org B (404)
- [ ] 11.3 `rules-rbac.e2e-spec.ts` : auditeur read OK, comptable simulate OK mais apply 403, expert_comptable tout OK

## 12. Documentation — follow-up

- [ ] 12.1 `docs/rules-engine.md` : concept d'union discriminée, mode simulate vs apply, codes erreur, exemples curl
- [ ] 12.2 Mettre à jour `docs/rbac.md` avec les 4 permissions `rules.{read,write,simulate,apply}`
- [ ] 12.3 Mettre à jour `docs/error-codes.md` avec les 3 codes Module 5

## 13. Pre-merge checks — follow-up

- [x] 13.1 `pnpm --filter backend test` passe (specs service + engine inclus)
- [x] 13.2 `pnpm --filter backend typecheck` propre
- [x] 13.3 Validation OpenSpec : `openspec validate --changes` → ce change valide
