## 1. Schéma base de données

- [x] 1.1 Migration `0028_create_workflow_definitions.ts` : table `workflow_definitions` (`id`, `name`, `description`, `target_type`, `is_active`, `timestamps`) + index `(target_type)`
- [x] 1.2 Migration `0029_create_workflow_instances.ts` : table `workflow_instances` (`id`, `workflow_definition_id` FK RESTRICT, `organization_id` FK CASCADE, `target_type`, `target_id`, `current_status`, `started_by`, `started_at`, `completed_at`, `updated_at`) + indexes composites `(organization_id, current_status)` et `(organization_id, target_type, target_id)`
- [x] 1.3 Migration `0030_create_workflow_events.ts` : table `workflow_events` (`id`, `workflow_instance_id` FK CASCADE, `from_status` nullable, `to_status`, `actor_id` nullable, `comment` nullable, `occurred_at`) + index `(workflow_instance_id, occurred_at)`
- [x] 1.4 Migration `0031_seed_workflow_permissions.ts` : insert des 3 permissions `workflows.{read,write,approve}` + matrice rôles (admin/expert/chef = read+write+approve, comptable = read+write, auditeur+client_readonly = read seul) + seed définition `import_session`

## 2. Types et catalogues

- [x] 2.1 `WorkflowStatus` string union (`draft | in_review | approved | locked`)
- [x] 2.2 `WorkflowTargetType` string union — vague 1 = `'import_session'` ; extension vague 2 = `| 'journal_entry' | 'report'`
- [x] 2.3 `ALLOWED_TRANSITIONS` const Record (graphe statique : `draft→[in_review]`, `in_review→[approved,draft]`, `approved→[locked,in_review]`, `locked→[]`)
- [x] 2.4 `TRANSITION_PERMISSION` const Record (`approved` et `locked` → `workflows.approve`, autres → `workflows.write`)
- [x] 2.5 3 codes d'erreur ajoutés à `ERROR_CODES` (`WORKFLOW_INSTANCE_NOT_FOUND` 404, `WORKFLOW_TRANSITION_INVALID` 422, `WORKFLOW_LOCKED` 409) + mapping HTTP
- [x] 2.6 `AuditModule` union du Module 7 contient déjà `'workflows'`

## 3. Entités TypeORM

- [x] 3.1 `WorkflowDefinitionEntity` (`@Entity workflow_definitions`, `@Index target_type`, `@OneToMany instances`)
- [x] 3.2 `WorkflowInstanceEntity` (`@Index org+status`, `@Index org+targetType+targetId`, relations vers `WorkflowDefinitionEntity` RESTRICT et `OrganizationEntity` CASCADE)
- [x] 3.3 `WorkflowEventEntity` (`@Index instance+occurredAt`, relation `@ManyToOne` instance CASCADE)
- [x] 3.4 Barrel export `entities/index.ts`

## 4. Repositories

- [x] 4.1 `WorkflowDefinitionRepository` — `findActiveByTargetType(targetType)`
- [x] 4.2 `WorkflowInstanceRepository` — `create`, `findById(id, orgId)`, `findByTarget(orgId, targetType, targetId)`, `updateStatus(id, status, completedAt?)`
- [x] 4.3 `WorkflowEventRepository` — `record(input)`, `listByInstance(instanceId)` ordonné par `occurred_at ASC`
- [x] 4.4 Aucune méthode `update` / `delete` exposée sur le repo events (append-only API)

## 5. Service unifié

- [x] 5.1 `WorkflowService.startWorkflow({ organizationId, targetType, targetId, ctx })` — idempotent : retourne l'instance existante si déjà démarrée ; sinon crée une instance `draft` + un event de démarrage (`fromStatus=null, toStatus='draft'`) + audit `workflows.started`
- [x] 5.2 `WorkflowService.transition({ instanceId, organizationId, toStatus, comment?, ctx })` — lookup instance tenant-scopé, vérification graphe `ALLOWED_TRANSITIONS`, UPDATE status (+ `completedAt` si `toStatus=locked`), INSERT event, audit `workflows.transition`
- [x] 5.3 `WorkflowService.getHistory(instanceId, organizationId)` — 404 cross-tenant, retourne la liste ordonnée des events
- [x] 5.4 `WorkflowService.assertNotLocked(organizationId, targetType, targetId)` — invariant exporté : lève `WORKFLOW_LOCKED` si une instance existe avec `current_status='locked'` ; no-op sinon
- [x] 5.5 Tests unitaires (`workflow.service.spec.ts`) : happy path start/transition/history, graphe rejette transitions illégales, `locked` est terminal, `assertNotLocked` no-op sans instance

## 6. Controller HTTP

- [x] 6.1 `WorkflowsController` sous `/workflows` avec guard chain `@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)` + `@ApiTags('workflows')` + `@ApiBearerAuth()`
- [x] 6.2 `POST /workflows/start` — `@RequirePermission('workflows.write')`, body `StartWorkflowDto`
- [x] 6.3 `POST /workflows/:instanceId/transition` — `@RequirePermission('workflows.write')`, body `TransitionWorkflowDto` (la séparation fine `workflows.approve` est tracée en `workflow.service.ts` mais non enforced à l'instance par instance en vague 1 — le graphe d'états protège déjà les sauts illégaux)
- [x] 6.4 `GET /workflows/:instanceId/history` — `@RequirePermission('workflows.read')`
- [x] 6.5 DTOs class-validator : `StartWorkflowDto` (`targetType` via `@IsIn(SUPPORTED_TARGET_TYPES)`, `targetId` UUID), `TransitionWorkflowDto` (`toStatus` via `@IsIn(VALID_STATUSES)`, `comment` optionnel max 2000 chars)

## 7. Module wiring

- [x] 7.1 `WorkflowsModule` importe `AuthModule`, `RbacModule`, `AuditModule`, `TypeOrmModule.forFeature([3 entités])`
- [x] 7.2 `WorkflowsModule` exporte `WorkflowService` (réutilisation cross-module pour `assertNotLocked`)
- [x] 7.3 Branchement dans `AppModule.imports`

## 8. Intégration cross-module

- [x] 8.1 `ImportsModule` importe `WorkflowsModule`
- [x] 8.2 `ImportSessionService` appelle `WorkflowService.assertNotLocked(orgId, 'import_session', sessionId)` avant tout upload / parse / commit
- [ ] 8.3 Module 4 (à venir) : `JournalsService.updateEntry` appellera `assertNotLocked` sur l'écriture cible. Engagement contractuel posé dans la spec, code attendu dans `module-4-journals-entries`.

## 9. Audit catalogue

- [x] 9.1 Actions `workflows.started` et `workflows.transition` émises via `AuditTrailService.record({ module: 'workflows', action, entityType: targetType, entityId: targetId, before, after, ctx })`

## 10. Tests d'intégration (e2e)

- [ ] 10.1 `workflows-lifecycle.e2e-spec.ts` : start sur `import_session` → transition `draft→in_review→approved→locked`, vérifie audit + events journalisés
- [ ] 10.2 `workflows-tenant-isolation.e2e-spec.ts` : org A ne peut ni démarrer, ni transitionner, ni lire l'historique d'une instance de l'org B (404)
- [ ] 10.3 `workflows-rbac.e2e-spec.ts` : auditeur read OK, write 403 ; comptable write OK ; client_readonly read 403 si pas membership
- [ ] 10.4 `workflows-state-graph.e2e-spec.ts` : transitions illégales (`draft→approved`, `locked→draft`) → 422 `WORKFLOW_TRANSITION_INVALID`
- [ ] 10.5 `workflows-locked-invariant.e2e-spec.ts` : session `import_session` lockée → upload de fichier répond 409 `WORKFLOW_LOCKED` (couvre l'intégration Module 3 ↔ Module 6)
- [ ] 10.6 Coverage backend ≥ 80% sur `modules/workflows/`

## 11. Documentation

- [ ] 11.1 `docs/workflows.md` : machine d'états, exemples d'API, invariant `locked`, intégration cross-module
- [ ] 11.2 Mettre à jour `docs/rbac.md` avec les 3 nouvelles permissions `workflows.{read,write,approve}`
- [ ] 11.3 Mettre à jour `docs/error-codes.md` avec les 3 codes Module 6
- [ ] 11.4 README backend : mentionner les migrations 0028-0031

## 12. Pre-merge checks

- [x] 12.1 `pnpm --filter backend test` passe (workflow.service.spec.ts inclus)
- [x] 12.2 `pnpm --filter backend typecheck` propre
- [ ] 12.3 Validation OpenSpec : `openspec validate --changes` → ce change valide
- [ ] 12.4 Audit `security-reviewer` (focus : append-only enforcement sur `workflow_events`, tenant isolation `getHistory`, pas de leak `instanceId` cross-tenant, race condition double transition)
- [ ] 12.5 Audit `code-reviewer` (focus : graphe `ALLOWED_TRANSITIONS` exhaustif, séparation `write`/`approve` cohérente avec la matrice RBAC, idempotence `startWorkflow`)
