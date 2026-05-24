# Module 3 — Moteur d'imports

## Pourquoi

Les cabinets OHADA récupèrent leurs données métier (relevés bancaires, balances Sage, exports Excel client) sous formats hétérogènes. Module 3 fournit un **moteur d'import à sessions** qui :

- accepte CSV / XLSX / Sage en upload multipart ;
- parse en lignes de staging (pas d'écriture comptable encore) ;
- expose un preview paginé avec validation ;
- journalise chaque étape dans le journal d'audit unifié.

La transformation staging → écritures comptables réelles (`commitSession`) est dans la vague 2 (dépend Module 4 — Journaux & écritures).

## Cycle de vie d'une session

```
draft  →  parsing  →  parsed  →  preview  →  (committed | failed)
```

| État | Transitions sortantes | Mutations autorisées |
|---|---|---|
| `draft` | `parsing` (upload+parse) | upload file, change label |
| `parsing` | `parsed`, `failed` | aucune (verrou interne service) |
| `parsed` | `preview`, `failed` | preview, mapping de colonnes |
| `preview` | `committed` (vague 2), `failed` | mapping, validation |
| `failed` | terminal | aucune |
| `committed` | terminal | aucune |

Toute mutation hors transition légale lève `IMPORT_SESSION_NOT_DRAFT` (409) ou `IMPORT_SESSION_NOT_PARSED` (409).

## Endpoints

Tous sous `/organizations/:id/imports/*`, gated par `JwtAuthGuard + TenantGuard + PermissionsGuard`.

| Méthode | URL | Permission | Description |
|---|---|---|---|
| `POST` | `/sessions` | `imports.write` | Crée une session en `draft` |
| `GET` | `/sessions` | `imports.read` | Liste paginée des sessions de l'org |
| `GET` | `/sessions/:sessionId` | `imports.read` | Détail d'une session (état, fichiers attachés, compteurs) |
| `POST` | `/sessions/:sessionId/files` | `imports.write` | Upload multipart d'un fichier (CSV/XLSX/Sage) — parse immédiat |
| `POST` | `/sessions/:sessionId/preview?page&pageSize` | `imports.read` | Lignes staging paginées + validation |

## Limites + sécurité

| Limite | Valeur par défaut | Variable env | Code d'erreur |
|---|---|---|---|
| Taille max fichier | 50 MB | `IMPORT_MAX_FILE_SIZE_MB` | `IMPORT_FILE_TOO_LARGE` (413) |
| Multer transport cap | `MAX_FILE_SIZE_MB + 1` MB | (dérivé) | aborté par multer (400) |
| Formats acceptés | CSV, XLSX, Sage CCMX | hardcodé | `IMPORT_UNSUPPORTED_FORMAT` (422) |
| Dédupe intra-session | SHA256 du contenu | — | `IMPORT_FILE_DUPLICATE` (409) |

### Hardening Sec-M3 (parsers + storage)

- **MIME sniff** (magic bytes) en tête du pipeline upload : un `.csv` dont les bytes sont un EXE est rejeté avant le parser CSV (vector "fake CSV containing exploit").
- **Tenant isolation** : tous les repositories filtrent sur `organization_id`. Une session/file/staging row appartenant à l'org B n'est jamais visible avec un token org A → 404 `IMPORT_SESSION_NOT_FOUND` (jamais 403).
- **Path traversal** : le nom de fichier soumis par le client n'est jamais utilisé tel quel comme storage key — le service génère un UUID et stocke la mapping en DB. Un upload `../../etc/passwd` est sans effet sur le filesystem.

## Permissions RBAC

| Rôle | `imports.read` | `imports.write` |
|------|:---:|:---:|
| `admin` | ✓ | ✓ |
| `expert_comptable` | ✓ | ✓ |
| `chef_mission` | ✓ | ✓ |
| `comptable` | ✓ | ✓ |
| `auditeur` | ✓ | ✗ |
| `client_readonly` | ✓ | ✗ |

Le `comptable` (saisie) PEUT créer des sessions et uploader des fichiers : c'est le cœur de son workflow, et `commit` (vague 2) demandera une permission séparée plus restrictive (`imports.commit`).

## Audit (journal unifié `audit_logs`)

Émis par `AuditTrailService.record({ module: 'imports', action: ..., entity: ... })` :

- `imports.session_created` — création de session (entityType=`import_session`)
- `imports.file_uploaded` — fichier uploadé (entityType=`import_file`)
- `imports.file_parsed` — parsing OK (`metadata: { rowsParsed, headers }`)
- `imports.preview_generated` — preview consulté (`metadata: { page, pageSize, totalRows }`)
- `imports.session_failed` — échec terminal (`metadata: { reason, stage }`)

Requête type : `GET /audit/logs?module=imports&action=file_parsed&from=2026-05-01`.

## Codes d'erreur (cf. `docs/error-codes.md`)

| Code | HTTP | Trigger |
|---|---|---|
| `IMPORT_SESSION_NOT_FOUND` | 404 | session inexistante OU cross-tenant probe |
| `IMPORT_SESSION_NOT_DRAFT` | 409 | upload après parse / preview |
| `IMPORT_SESSION_NOT_PARSED` | 409 | preview avant parse |
| `IMPORT_FILE_NOT_FOUND` | 404 | file id inexistant dans la session |
| `IMPORT_FILE_TOO_LARGE` | 413 | dépasse `IMPORT_MAX_FILE_SIZE_MB` |
| `IMPORT_FILE_DUPLICATE` | 409 | même SHA256 déjà attaché à la session |
| `IMPORT_UNSUPPORTED_FORMAT` | 422 | MIME non whitelisté ou sniffer en désaccord avec l'extension |
| `IMPORT_FILE_PARSE_FAILED` | 422 | parser CSV/XLSX/Sage a levé une erreur structurée |

## Tests e2e

- `apps/backend/test/imports-engine.e2e-spec.ts` — 5 scenarios (12.1–12.5) : lifecycle complet, tenant isolation, permissions, MIME validation, dedupe.

## Limites connues (vague 2)

- `commitSession` — staging → écritures réelles (dépend Module 4).
- Driver storage S3 / Supabase Storage — actuellement filesystem local seulement (`apps/backend/storage/imports/`).
- Mapping de colonnes interactif côté frontend — actuellement le mapping est inféré ou défini en API.
- Background processing — actuellement parsing en synchrone dans la requête HTTP (acceptable jusqu'à ~50 MB / ~50k lignes).
