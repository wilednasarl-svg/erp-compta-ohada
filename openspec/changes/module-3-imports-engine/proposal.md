## Why

Le Module 1 (auth + multi-tenant + RBAC) et le Module 2 (plan comptable OHADA SYSCOHADA) posent le socle. Avant le Module 4 (écritures et balance) il faut un **moteur d'import** pour ingérer la masse de données existantes des cabinets : extraits bancaires CSV de la BICICI / SGCI / ECOBANK, exports Sage `.txt`, journaux Excel, factures scannées (PDF/image). Sans cette couche, un nouveau cabinet doit ressaisir manuellement plusieurs centaines d'écritures par client — c'est le frein opérationnel n°1 à l'adoption en cabinet OHADA aujourd'hui.

Le moteur expose un workflow en sessions explicites (l'utilisateur ouvre une session, dépose un ou plusieurs fichiers, mappe les colonnes, prévisualise les lignes validées, et — vague 2 — commit dans les écritures comptables réelles). Le stockage des fichiers téléversés est isolé dans un sous-module `documents` qui sert aussi de coffre-fort pour les pièces justificatives (factures, contrats) référencées par les écritures du Module 4.

## What Changes

- Introduction de la capacité **`imports`** : sessions d'import multi-tenant (`draft → parsing → parsed → validated → ready_for_import → completed | failed`), upload de fichiers (CSV / XLSX / Sage `.txt`), parsing en **table de staging** (`import_staging_entries`) sans écriture sur les comptes réels, mapping automatique des colonnes par synonymes (date / pieceRef / accountCode / label / debit / credit / vatCode), validation ligne à ligne (parse date OHADA, montants > 0, équilibre débit/crédit par pièce, compte existant et `POSTING` dans le plan de l'org), et preview paginée avant commit.
- Introduction de la capacité **`documents`** : entité `Document` (FK org + uploader) + entité de liaison `DocumentEntry` (à brancher au Module 4 pour rattacher un document à une écriture). Upload avec validation MIME stricte (PDF/JPEG/PNG/CSV/XLSX/TXT), limite de taille, stockage via interface `DocumentStorage` (driver local par défaut, S3 / Supabase Storage en vague 2). Stub OCR (`OcrStatus`) en place pour la vague 2.
- Ajout de **4 migrations** : `0015 import_sessions`, `0016 import_files`, `0017 import_staging_entries`, `0018 imports permissions` (+ `documents.*` permissions branchées dans la même migration pour cohérence RBAC).
- Ajout de **2 permissions par capacité** dans la matrice RBAC : `imports.read` / `imports.write` et `documents.read` / `documents.write`. Le rôle `comptable` peut écrire des imports (son métier de saisie en masse) ; l'`auditeur` lit uniquement.
- Nouveaux codes d'erreur catalogués (`IMPORT_SESSION_NOT_FOUND`, `IMPORT_SESSION_NOT_DRAFT`, `IMPORT_SESSION_NOT_PARSED`, `IMPORT_FILE_NOT_FOUND`, `IMPORT_FILE_TOO_LARGE`, `IMPORT_FILE_DUPLICATE`, `IMPORT_UNSUPPORTED_FORMAT`, `IMPORT_FILE_PARSE_FAILED`, `DOC_NOT_FOUND`, `DOC_FILE_REQUIRED`, `DOC_FILE_TOO_LARGE`, `DOC_MIME_REJECTED`, `DOC_STORAGE_FAILURE`) avec mapping HTTP cohérent.
- 13 nouveaux endpoints HTTP sous `/organizations/:id/imports/*` (6) et `/documents/*` (7) — guard chain identique au Module 2 (`JwtAuthGuard` + `TenantGuard` + `PermissionsGuard`).
- 6 nouveaux événements `auth_events` (`imports.session_created`, `imports.file_uploaded`, `imports.file_parsed`, `imports.file_parse_failed`, `documents.uploaded`, `documents.deleted`).

## Capabilities

### New Capabilities
- `imports` : moteur d'ingestion de fichiers comptables. Sessions, parsing, mapping, validation, preview. Le commit vers les écritures comptables réelles (`accounting_entries`) sortira en vague 2 quand le Module 4 sera posé.
- `documents` : coffre-fort de pièces justificatives. Upload + storage abstrait + métadonnées (mime, size, hash, uploader). Read/list/delete par org. Branchement aux écritures via `DocumentEntry` en vague 2.

### Modified Capabilities
- `rbac` : extension de la matrice avec 4 permissions (`imports.{read,write}`, `documents.{read,write}`). Pas de nouveau rôle.

## Impact

- **Backend (NestJS)** : 2 nouveaux modules (`ImportsModule`, `DocumentsModule`) branchés dans `AppModule` ; 6 entités TypeORM ; 6 repositories tenant-scopés ; 5 services (`ImportSessionService`, `FileParserService` + 3 parsers `csv|xlsx|sage`, `MappingService`, `ValidationService`, `DocumentsService`, `DocumentOcrService` stub) ; 2 controllers HTTP.
- **Base de données** : 4 nouvelles tables (`import_sessions`, `import_files`, `import_staging_entries`, `documents`) — tables `document_entries` (FK Module 4) seront posées en vague 2. Aucun changement aux tables Module 1 / Module 2.
- **Sécurité — surface d'attaque élargie** : upload de fichiers user-supplied = nouvelle classe de risques (path traversal, XLSX zip-bombs / formula injection, CSV / SVG dans PDF, oversized uploads DoS). La présente proposal explicite les contre-mesures (cf. spec sections `Validation` et `Storage`).
- **Dépendances** : ajout de `fast-csv@^5`, `xlsx@^0.18`, `iconv-lite@^0.6` (déjà déclarées dans `apps/backend/package.json` ; pose la question d'une migration vers une lib XLSX maintenue à plus long terme — `xlsx-populate` ou `exceljs` — à acter en vague 2).
- **Frontend (Next.js 15)** : pas dans le scope de cette change ; arrivera dans `module-3b-imports-frontend`. Le présent change pose UNIQUEMENT le backend.
- **Module 4 (écritures)** : consommera la table `import_staging_entries` au moment du commit. La staging table porte déjà les colonnes adaptées (`date`, `account_code`, `label`, `debit`, `credit`, `piece_ref`, `vat_code`).
- **Module 7 (audit)** : les 6 nouveaux types d'événements `auth_events` sont déjà ajoutés à `AuthEventType`.
