## 1. Schéma base de données

- [x] 1.1 Migration `0033_create_entry_transformations.ts` : table avec `id`, `organization_id`, `source_entry_id`, `type`, `status`, `before_values` (JSONB), `after_values` (JSONB), `notes`, `created_by_id`, `created_at`, `cancelled_at`, `cancelled_by_id`, `cancel_reason`
- [x] 1.2 FK : org (ON DELETE CASCADE), source_entry (ON DELETE CASCADE vers `import_staging_entries`), created_by (ON DELETE RESTRICT), cancelled_by (ON DELETE RESTRICT)
- [x] 1.3 CHECK contraintes : `chk_entry_transformations_type` (5 valeurs : reclassification, adjustment, correction, ventilation, grouping), `chk_entry_transformations_status` (active | cancelled), `chk_entry_transformations_cancelled_consistency` (status=cancelled ↔ cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL)
- [x] 1.4 Indexes composites : `(organization_id, source_entry_id)` (history par écriture), `(organization_id, type, status)` (dashboard par type/statut), `(organization_id, created_at DESC)` (feed chronologique)
- [x] 1.5 Migration `0034_add_transformations_permissions.ts` : insert idempotent `transformations.read` + `transformations.write` + matrice rôles (cf. D6 design — read tous rôles métier, write sans auditeur ni client_readonly)

## 2. Types et catalogues

- [x] 2.1 `TransformationType` union (`reclassification | adjustment | correction | ventilation | grouping`) — 5 valeurs au catalogue dont 3 réservées pour wave 2
- [x] 2.2 `TransformationStatus` union (`active | cancelled`)
- [x] 2.3 `ReclassifiableField` union (`account | journal | partner | label`)
- [x] 2.4 `TransformationDiff` shape (Partial sur ReclassifiableField + champs `adjustmentDebit | adjustmentCredit | adjustmentLabel` optionnels)
- [x] 2.5 3 codes d'erreur ajoutés à `ERROR_CODES` (`TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` → 404, `TRANSFORMATION_NO_FIELD_CHANGED` → 422, `TRANSFORMATION_ADJUSTMENT_INVALID` → 422) + mapping HTTP

## 3. Entité TypeORM

- [x] 3.1 `EntryTransformationEntity` avec 3 `@Index` composite (org+source, org+type+status, org+createdAt)
- [x] 3.2 Relations `@ManyToOne` vers `OrganizationEntity`, `ImportStagingEntryEntity`, `UserEntity` (createdBy + cancelledBy)
- [x] 3.3 Colonnes JSONB `beforeValues` / `afterValues` typées `TransformationDiff` avec default `'{}'::jsonb`

## 4. Repository

- [x] 4.1 `EntryTransformationRepository` tenant-scopé (`assertTenantId` sur toutes les méthodes publiques)
- [x] 4.2 Méthodes : `create(input)`, `findBySourceEntry(orgId, sourceEntryId)` ordre `createdAt ASC`, `findById(orgId, id)`
- [x] 4.3 Pas de méthode `update`, `delete` exposée (soft-delete via status, mais pas en wave 1)

## 5. Service `TransformationService`

- [x] 5.1 `reclassifyEntry(orgId, actorId, dto, ctx)` — build diff sparse depuis dto (account / journal / partner / label), garde `TRANSFORMATION_NO_FIELD_CHANGED` si aucun champ
- [x] 5.2 `adjustEntry(orgId, actorId, dto, ctx)` — XOR strict entre `adjustmentDebit` et `adjustmentCredit`, garde `TRANSFORMATION_ADJUSTMENT_INVALID` sinon
- [x] 5.3 `getEntryHistory(orgId, sourceEntryId)` — vérifie tenant via resolveSourceEntry puis retourne chain complète chronologique (active + cancelled)
- [x] 5.4 `resolveSourceEntry` privé : JOIN `import_sessions` pour vérifier tenant ; cross-tenant → `TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` (404 fail-closed)
- [x] 5.5 Émission audit via `AuditTrailService.record` pour chaque mutation (module `transformations`, actions `entry_reclassified` / `entry_adjusted`) avec diff before/after
- [x] 5.6 Export du service dans `TransformationsModule.exports` pour consommation par Module 4 wave 2 (journaux)

## 6. Controller HTTP

- [x] 6.1 `TransformationsController` (`organizations/:id/transformations`) — 3 endpoints sous `@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)`
- [x] 6.2 `POST /reclassify` `@RequirePermission('transformations.write')` `HTTP 201`
- [x] 6.3 `POST /adjust` `@RequirePermission('transformations.write')` `HTTP 201`
- [x] 6.4 `GET /entries/:entryId/history` `@RequirePermission('transformations.read')`
- [x] 6.5 Garde `assertOrgMatch` (path orgId vs token orgId) + `assertActor` (defensive, JwtAuthGuard amont)
- [x] 6.6 Swagger `@ApiTags('Transformations')` + `@ApiBearerAuth('bearer')`

## 7. DTOs

- [x] 7.1 `ReclassifyEntryDto` class-validator : `sourceEntryId` (UUID requis), `account` / `journal` / `partner` / `label` (string optionnels), `notes` (string optionnel)
- [x] 7.2 `AdjustEntryDto` class-validator : `sourceEntryId` (UUID requis), `adjustmentDebit` / `adjustmentCredit` (decimal positif optionnels, XOR validé côté service), `adjustmentLabel` (string requis), `notes` (string optionnel)

## 8. Module wiring

- [x] 8.1 `TransformationsModule` branché dans `AppModule` (après `ImportsModule`)
- [x] 8.2 `TypeOrmModule.forFeature([EntryTransformationEntity, ImportStagingEntryEntity])` — ImportStagingEntryEntity en read-only, sans réimporter `ImportsModule` (évite dépendance circulaire)
- [x] 8.3 Imports `AuthModule`, `RbacModule`, `AuditModule`

## 9. Audit catalogue

- [x] 9.1 Module `transformations` déjà présent au catalogue `AuditModule` (Module 7) — pas de modification du Module 7 requise
- [x] 9.2 2 nouvelles actions : `entry_reclassified`, `entry_adjusted`

## 10. Tests unitaires

- [x] 10.1 `transformation.service.spec.ts` : happy path reclassify, happy path adjust, garde no-field-changed, garde XOR adjustment, garde cross-tenant 404, audit appelé avec bon diff
- [x] 10.2 Tests appelant `getEntryHistory` retournent chain complète incluant transformations cancelled

## 11. Tests d'intégration (e2e) — follow-up

- [ ] 11.1 `transformations-lifecycle.e2e-spec.ts` : create reclassify → adjust → history sur même écriture source
- [ ] 11.2 `transformations-tenant-isolation.e2e-spec.ts` : org A ne peut pas créer/lire transformations sur sourceEntry d'org B (404 systématique)
- [ ] 11.3 `transformations-permissions.e2e-spec.ts` : auditeur read OK, write 403 ; comptable write OK ; client_readonly aucun accès
- [ ] 11.4 Coverage backend ≥ 80% sur `modules/transformations/`

## 12. Documentation — follow-up

- [ ] 12.1 `docs/transformations.md` : invariant immuabilité des sources, workflow reclassement vs ajustement, codes erreur, exemples curl
- [ ] 12.2 Mettre à jour `docs/rbac.md` avec les 2 nouvelles permissions (`transformations.read` / `.write`) et matrice rôles
- [ ] 12.3 Mettre à jour `docs/error-codes.md` avec les 3 nouveaux codes Module 4

## 13. Pre-merge checks — follow-up

- [x] 13.1 `pnpm --filter backend typecheck` propre
- [x] 13.2 `pnpm --filter backend test` passe pour les specs unitaires de ce module
- [ ] 13.3 Validation OpenSpec `openspec validate --changes` → ce change valide
- [ ] 13.4 Audit `security-reviewer` (focus : invariant immuabilité, tenant isolation par JOIN, soft-delete schema-only sans endpoint exposé en wave 1)
- [ ] 13.5 Audit `code-reviewer` (focus : signature service exportée stable pour Module 4 wave 2, cohérence des branches reclassify vs adjust)
