## 1. Schéma base de données

- [x] 1.1 Migration `0015_create_import_sessions.ts` : table avec `id`, `organization_id`, `created_by_user_id`, `name`, `source_type`, `status`, `started_at`, `completed_at`, `error_message`, `timestamps` + CHECK contraintes (status, source_type) + indexes composites `(organization_id, status)` et `(organization_id, created_at DESC)`
- [x] 1.2 Migration `0016_create_import_files.ts` : table avec `id`, `import_session_id` (FK CASCADE), `original_filename`, `storage_key`, `mime_type`, `size_bytes`, `sha256`, `status`, `parsed_at`, `parse_error`, `row_count`, `timestamps` + UNIQUE `(import_session_id, sha256)` + CHECK statuts
- [x] 1.3 Migration `0017_create_import_staging_entries.ts` : table avec `id`, `import_file_id` (FK CASCADE), `row_number`, `raw_columns` (JSONB), `mapped_date`, `mapped_account_code`, `mapped_label`, `mapped_debit`, `mapped_credit`, `mapped_piece_ref`, `mapped_vat_code`, `validation_errors` (JSONB array), `timestamps`
- [x] 1.4 Migration `0018_add_imports_permissions.ts` : insert des 4 permissions `imports.{read,write}` + `documents.{read,write}` + matrice rôles (cf. design D6)
- [x] 1.5 Migration documents table (`documents` avec org_id, uploader, filename, mime, size, hash, storage_key, ocr_status, soft-delete) — livrée

## 2. Types et catalogues

- [x] 2.1 `ImportSessionStatus` enum + `IMPORT_SESSION_STATUSES` array — 7 valeurs (draft/parsing/parsed/validated/ready_for_import/completed/failed)
- [x] 2.2 `ImportSourceType` enum (csv/excel/sage/txt)
- [x] 2.3 `ImportFileStatus` enum (uploaded/parsing/parsed/parse_failed)
- [x] 2.4 `TargetField` + `REQUIRED_TARGET_FIELDS` + `HEADER_SYNONYMS` table figée (~10 entrées par champ FR/EN)
- [x] 2.5 `ValidationError` shape + `ValidationErrorCode` enum (~10 codes : INVALID_DATE, UNKNOWN_ACCOUNT, ACCOUNT_NOT_POSTING, UNBALANCED_PIECE, INVALID_AMOUNT…)
- [x] 2.6 `OcrStatus` enum (pending/processing/processed/failed/skipped) stub
- [x] 2.7 13 codes d'erreur ajoutés à `ERROR_CODES` + mapping HTTP

## 3. Entités TypeORM

- [x] 3.1 `ImportSessionEntity` (`@Index(['organizationId','status'])`, relation `@ManyToOne` User)
- [x] 3.2 `ImportFileEntity` (`@OneToMany staging`, relation `@ManyToOne` session ON DELETE CASCADE)
- [x] 3.3 `ImportStagingEntryEntity` (JSONB columns pour `rawColumns` et `validationErrors`)
- [x] 3.4 `DocumentEntity` (org_id + uploader_id + soft-delete)
- [x] 3.5 `DocumentEntryEntity` stub (liaison avec écritures Module 4 — vague 2)

## 4. Repositories

- [x] 4.1 `ImportSessionRepository` tenant-scopé (`assertTenantId` partout, `TenantId | string` signatures)
- [x] 4.2 `ImportFileRepository` tenant-scopé + méthode `existsByHashInSession`
- [x] 4.3 `ImportStagingEntryRepository` tenant-scopé + bulk insert
- [x] 4.4 `DocumentRepository` tenant-scopé + soft-delete
- [x] 4.5 `DocumentEntryRepository` stub

## 5. Storage abstrait

- [x] 5.1 Interface `DocumentStorage` avec `save(input): SaveDocumentResult` et `openReadStream(storageKey)` (cf. design D2)
- [x] 5.2 Driver `LocalFilesystemDocumentStorage` avec validation `storageKey` regex + path resolution tenant-scopé
- [x] 5.3 Token `DOCUMENT_STORAGE` injection + binding dans `DocumentsModule.providers`
- [x] 5.4 Tests unitaires (path traversal rejected, hash mismatch detected, write+read roundtrip)
- [ ] 5.5 Driver S3 / Supabase Storage (vague 2)

## 6. Parsers de fichiers

- [x] 6.1 Interface `IFileParser` + `ParseResult` + `ParseContext`
- [x] 6.2 `CsvFileParser` (fast-csv) — auto-détection encoding latin1/utf8, séparateur (`,` / `;` / `\t`), normalize header
- [x] 6.3 `XlsxFileParser` (xlsx) — limites `sheetRows: 100_000` + `cellFormula: false` (cf. design D8)
- [x] 6.4 `SageFileParser` — format texte fixe Sage 100/Saari (largeurs colonnes)
- [x] 6.5 `FileParserService` qui dispatch sur le MIME validé serveur
- [x] 6.6 Tests unitaires : roundtrip CSV avec accents, XLSX avec dates Excel (serial → ISO), Sage avec champs vides

## 7. Mapping et validation

- [x] 7.1 `MappingService.proposeMapping(headers): MappingProposal` — normalize + lookup synonymes
- [x] 7.2 `MappingService.applyMapping(rawRows, mapping): MappedRow[]`
- [x] 7.3 `ValidationService.validate(rows, plan): ValidationError[][]` — date, montants, balance, compte existant + POSTING
- [x] 7.4 Tests unitaires : synonymes FR/EN matchent, champs requis absents → ValidationError, balance débit/crédit par pièce, compte TITLE rejeté

## 8. Service d'orchestration `ImportSessionService`

- [x] 8.1 `createSession(orgId, userId, name, sourceType): SessionSummary` — status draft, audit `imports.session_created`
- [x] 8.2 `listSessions(orgId, filter?): SessionSummary[]`
- [x] 8.3 `getSession(orgId, sessionId): SessionSummary` (404 cross-tenant)
- [x] 8.4 `uploadFile(orgId, userId, sessionId, multipartFile): UploadedFileSummary` — MIME allowlist, taille, sha256, dedupe, audit `imports.file_uploaded`
- [x] 8.5 `parseFile(orgId, sessionId, fileId): ParseFileResult` — dispatch parser, persist staging entries, audit `imports.file_parsed` ou `imports.file_parse_failed`
- [x] 8.6 `preview(orgId, sessionId, { page, pageSize }): PreviewResult` — paginate les lignes staging + validation au passage
- [ ] 8.7 `commitSession` (vague 2 — Module 4 requis)
- [x] 8.8 Tests unitaires : tous les invariants (tenant, MIME, dedupe, état transitions, JOIN staging)

## 9. Service Documents

- [x] 9.1 `DocumentsService.createFromUpload(orgId, userId, multipartFile): DocumentView` — MIME allowlist + size limit + sha256 + storage
- [x] 9.2 `DocumentsService.getForOrg(orgId, docId): DocumentView` — 404 cross-tenant
- [x] 9.3 `DocumentsService.openStreamForOrg(orgId, docId): NodeJS.ReadableStream`
- [x] 9.4 `DocumentsService.listForOrg(orgId, { page, pageSize, mimeFilter? }): { docs, total }`
- [x] 9.5 `DocumentsService.softDelete(orgId, docId, actorUserId)` — sets deleted_at, audit `documents.deleted`. Le fichier physique reste (purge cron en vague 2).
- [x] 9.6 `DocumentOcrService` stub (interface en place pour vague 2)
- [x] 9.7 Tests unitaires (createFromUpload, MIME rejected, size limit, tenant isolation)

## 10. Controllers HTTP

- [x] 10.1 `ImportsController` (`organizations/:id/imports`) — 6 endpoints sous `@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)` avec `@RequirePermission('imports.read'|'.write')`
- [x] 10.2 `DocumentsController` (`/documents`) — 5 endpoints (POST upload, GET list, GET :id, GET :id/content streamable, DELETE :id)
- [x] 10.3 DTOs class-validator (`CreateImportSessionDto`, `PreviewImportDto`, `UploadDocumentDto`, `ListDocumentsQueryDto`)
- [x] 10.4 Swagger `@ApiTags('Imports')` + `@ApiTags('Documents')` + `@ApiBearerAuth('bearer')`

## 11. Audit catalogue

- [x] 11.1 6 nouveaux types `AuthEventType` (`imports.session_created`, `imports.file_uploaded`, `imports.file_parsed`, `imports.file_parse_failed`, `documents.uploaded`, `documents.deleted`)

## 12. Tests d'intégration (e2e)

- [ ] 12.1 `imports-session-lifecycle.e2e-spec.ts` : create draft → upload CSV → parse → preview, vérifie audit + staging
- [ ] 12.2 `imports-tenant-isolation.e2e-spec.ts` : org A ne peut ni voir ni modifier sessions / files / staging de l'org B (404)
- [ ] 12.3 `imports-permissions.e2e-spec.ts` : auditeur read OK, write 403 ; comptable write OK
- [ ] 12.4 `imports-mime-validation.e2e-spec.ts` : upload EXE déguisé en CSV → 422 IMPORT_UNSUPPORTED_FORMAT
- [ ] 12.5 `imports-dedupe.e2e-spec.ts` : 2 uploads avec même sha256 dans même session → 409 IMPORT_FILE_DUPLICATE
- [ ] 12.6 `documents-upload-download.e2e-spec.ts` : upload PDF, list, download, soft-delete
- [ ] 12.7 `documents-storage-path-traversal.e2e-spec.ts` : tentative `storageKey: '../../etc/passwd'` → 404
- [ ] 12.8 Coverage backend ≥ 80% sur `modules/imports/` et `modules/documents/`

## 13. Documentation

- [x] 13.1 `docs/imports.md` : workflow sessions, mapping de colonnes, codes erreur, limites
- [x] 13.2 `docs/documents.md` : limites MIME et taille, storage abstrait, isolation tenant
- [x] 13.3 Mettre à jour `docs/rbac.md` avec les 4 nouvelles permissions
- [x] 13.4 `docs/error-codes.md` étendu avec les 13 nouveaux codes Module 3
- [x] 13.5 README backend : mentionner les migrations 0015-0018 et la variable `DOCUMENTS_STORAGE_DIR`

## 14. Pre-merge checks

- [x] 14.1 `pnpm --filter backend test` passe (407/407 au moment du cadrage)
- [x] 14.2 `pnpm --filter backend typecheck` propre
- [x] 14.3 Validation OpenSpec : `openspec validate --changes` → ce change valide
- [x] 14.4 Audit `security-reviewer` sur les parsers, le storage et l'upload (focus path traversal, XLSX bombs, MIME spoofing, tenant isolation)
- [x] 14.5 Audit `code-reviewer` sur les services et l'invariant de transitions d'état
