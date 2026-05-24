## ADDED Requirements

### Requirement: Documents are tenant-scoped with server-side MIME validation

The system SHALL expose a documents capability for uploading and retrieving supporting evidence (PDFs, scanned images, source CSV/XLSX). Each `documents` row carries `organization_id`, `uploader_user_id`, `original_filename`, `mime_type`, `size_bytes`, `sha256`, `storage_key`, `ocr_status`, `deleted_at`. Every read or write MUST be guarded by `JwtAuthGuard + TenantGuard + PermissionsGuard` and scope on the JWT `org_id` claim.

#### Scenario: Authenticated upload of a permitted PDF
- **WHEN** an authenticated user with `documents.write` uploads `facture-bicici.pdf` (`application/pdf`, 1.2 MB)
- **THEN** the system computes SHA-256, persists a `documents` row, writes the file under `${DOCUMENTS_STORAGE_DIR}/${orgId}/${storageKey}`, responds `201` and emits `documents.uploaded`

#### Scenario: Upload of a disallowed MIME
- **WHEN** a user uploads an `application/x-msdownload` (Windows executable)
- **THEN** the system responds `422 DOC_MIME_REJECTED` without writing to disk

#### Scenario: Upload above size cap
- **WHEN** a user uploads a 30 MB file (above the 25 MB cap for documents)
- **THEN** the system responds `413 DOC_FILE_TOO_LARGE`

### Requirement: Storage abstraction is opaque to consumers

The system SHALL persist file bytes via an injectable `DocumentStorage` interface with two operations: `save(input)` and `openReadStream(storageKey)`. The default driver `LocalFilesystemDocumentStorage` MUST:
- generate `storageKey = ${uuid}.${ext}` where `uuid` is server-generated (no client influence) and `ext` is derived from the validated MIME, not from the client filename;
- write under `${DOCUMENTS_STORAGE_DIR}/${organizationId}/${storageKey}`, with `organizationId` always sourced from the JWT;
- validate `storageKey` against `/^[a-f0-9-]+\.[a-z]{2,5}$/` before any `path.join`, refusing any value containing path-traversal characters with `404 DOC_NOT_FOUND` (intentional indistinguishability from "not exists").

#### Scenario: Path-traversal storage key is rejected
- **WHEN** the service is called with `storageKey = '../../../etc/passwd'` (a programming bug)
- **THEN** the service throws `DOC_NOT_FOUND` and never opens a file outside the storage root

#### Scenario: Cross-tenant file access via id is refused
- **WHEN** a user from org A calls `GET /documents/<idOfOrgB>/content`
- **THEN** the system responds `404 DOC_NOT_FOUND` (never streams the body) and emits `auth.cross_tenant_attempt`

### Requirement: Deletion is soft, with audit

`DELETE /documents/:id` SHALL set `deleted_at = now()` on the row but MUST NOT delete the underlying file. A scheduled purge job (wave 2) is the only path that removes bytes from disk — keeps an undo window for accidental deletions and preserves audit trail completeness.

#### Scenario: Soft-delete preserves audit and disk
- **WHEN** a user with `documents.write` deletes a document
- **THEN** the row's `deleted_at` is set, `GET /documents/:id` returns `404 DOC_NOT_FOUND`, the file on disk still exists, and `documents.deleted` is emitted to `auth_events`

### Requirement: Permissions matrix for documents

The catalogue MUST add `documents.read` and `documents.write`. The role × permission matrix MUST be:

| Role | documents.read | documents.write |
|---|:-:|:-:|
| admin | ✓ | ✓ |
| expert_comptable | ✓ | ✓ |
| chef_mission | ✓ | ✓ |
| comptable | ✓ | ✓ |
| auditeur | ✓ |  |
| client_readonly | ✓ |  |

`client_readonly` gets `documents.read` so the client can view invoices and contracts attached to their dossier; write stays restricted to staff roles.

#### Scenario: Auditeur reads, cannot delete
- **WHEN** an `auditeur` user attempts `DELETE /documents/:id`
- **THEN** the system responds `403 FORBIDDEN_PERMISSION`

### Requirement: OCR is stubbed for wave 1, contract documented for wave 2

Every `documents` row MUST carry an `ocr_status` column with values `pending | processing | processed | failed | skipped`. In wave 1 the default SHALL be `skipped` for non-image MIMEs and `pending` for images/PDFs; no OCR worker exists yet. The `DocumentOcrService` interface MUST be present so wave 2 can implement async processing without schema change.

#### Scenario: Upload of an image sets ocr_status to pending
- **WHEN** a user uploads `recu.jpg` (`image/jpeg`)
- **THEN** the persisted row has `ocr_status = 'pending'`

#### Scenario: Upload of a CSV skips OCR
- **WHEN** a user uploads `extract.csv` (`text/csv`)
- **THEN** the persisted row has `ocr_status = 'skipped'`
