# Module 10 — Document Engine (vague 1)

## Pourquoi

Les écritures comptables OHADA s'appuient sur des **pièces justificatives** : factures fournisseurs, relevés bancaires, contrats, attestations. Sans un système de stockage doté de :

- liaison `document ↔ écriture` formelle,
- audit trail (qui a uploadé quoi, quand, pour quel dossier),
- isolation tenant stricte,
- recherche par tags / type MIME / période,

… le cabinet est obligé de jongler entre Dropbox + Excel + emails, sans piste d'audit défendable face à un commissaire aux comptes.

Module 10 fournit cette couche. La vague 1 (livrée) couvre upload, listing, download, soft-delete, audit. La vague 2 introduira OCR + signature électronique.

## Endpoints

Tous sous `/documents`, gated par `JwtAuthGuard + TenantGuard + PermissionsGuard`.

| Méthode | URL | Permission | Description |
|---|---|---|---|
| `POST` | `/documents` (multipart) | `documents.write` | Upload : `file` + `tags?` + `linkedEntryIds?` + `description?` |
| `GET` | `/documents?tag&mimeType&uploadedBy&page&pageSize` | `documents.read` | Liste paginée + filtres |
| `GET` | `/documents/:id` | `documents.read` | Métadonnées d'un document |
| `GET` | `/documents/:id/content` | `documents.read` | Stream binaire avec `Content-Disposition` |
| `DELETE` | `/documents/:id` | `documents.write` | Soft-delete (row reste, fichier reste, `deletedAt` set) |

## Limites + sécurité

| Limite | Valeur | Variable env | Code d'erreur |
|---|---|---|---|
| Taille max upload | 25 MB | `DOC_MAX_FILE_SIZE_MB` | `DOC_FILE_TOO_LARGE` (413) |
| Multer transport cap | `DOC_MAX_FILE_SIZE_MB + 1` MB | (dérivé) | aborté par multer (400) |
| MIME whitelist | PDF, JPEG, PNG, CSV, XLSX | hardcodé | `DOC_MIME_REJECTED` (422) |
| Storage backend | filesystem local | `DOCUMENTS_STORAGE_DIR` (par défaut `./storage/documents/`) | `DOC_STORAGE_FAILURE` (500) |

### Hardening Sec-M4 (download)

- **CRLF strip** sur `filename` stocké avant insertion dans `Content-Disposition` — protège contre l'injection de headers via un nom de fichier `evil.pdf\r\nX-Injected: foo`.
- **RFC 5987** : `filename*=UTF-8''<percent-encoded>` — les noms non-ASCII (français accentué, arabe, idéogrammes) survivent au round-trip browser.
- **`X-Content-Type-Options: nosniff`** sur chaque download — empêche IE/Edge legacy de re-sniffer le contenu et de l'exécuter comme HTML.
- **`Cache-Control: private, no-store`** — les documents comptables ne doivent jamais être mis en cache par un proxy intermédiaire.

### Isolation tenant

Le `DocumentRepository` exige `organizationId` sur tout `find` / `findById`. Un token org A demandant `GET /documents/<bobs-uuid>` reçoit `404 DOC_NOT_FOUND` (jamais 403, jamais 200 partiel) — pas de leak d'existence.

## Permissions RBAC

| Rôle | `documents.read` | `documents.write` |
|------|:---:|:---:|
| `admin` | ✓ | ✓ |
| `expert_comptable` | ✓ | ✓ |
| `chef_mission` | ✓ | ✓ |
| `comptable` | ✓ | ✓ |
| `auditeur` | ✓ | ✗ |
| `client_readonly` | ✓ | ✗ |

## Audit (journal unifié)

Émis par `AuditTrailService.record({ module: 'documents', ... })` :

- `documents.uploaded` — `after = { filename, mimeType, sizeBytes, sha256Checksum, tags, description }`
- `documents.linked_entry` — `after = { entryIds }` (si l'upload spécifie `linkedEntryIds`)
- `documents.soft_deleted` — `before = { filename, mimeType, sizeBytes, tags }, after = null`

Requête type : `GET /audit/logs?module=documents&action=uploaded&from=2026-05-01`.

## Codes d'erreur

| Code | HTTP | Trigger |
|---|---|---|
| `DOC_NOT_FOUND` | 404 | document inexistant OU cross-tenant probe |
| `DOC_FILE_REQUIRED` | 422 | upload sans champ `file` multipart |
| `DOC_FILE_TOO_LARGE` | 413 | dépasse `DOC_MAX_FILE_SIZE_MB` |
| `DOC_MIME_REJECTED` | 422 | MIME hors whitelist (PDF/JPEG/PNG/CSV/XLSX) |
| `DOC_STORAGE_FAILURE` | 500 | erreur I/O du driver (filesystem plein, permission denied) |

## Tests e2e

- `apps/backend/test/documents-engine.e2e-spec.ts` — 3 scenarios (12.6 + 12.7) : round-trip upload→list→download→soft-delete, isolation tenant, path-traversal sanitisé dans le header de download.

## Roadmap

- **Vague 2** : OCR (Tesseract local ou API tierce), driver storage S3 / Supabase Storage, signed URLs, signature électronique (eIDAS-compatible si possible pour les jurisdictions OHADA UEMOA/CEMAC).
- **Module 4** intégration : champ `linkedEntryIds` actuellement opaque côté Module 10. Une fois Module 4 livré, le repo `EntryDocument` (FK forte) viendra remplacer l'array JSON.
