## Context

Le moteur d'import est la passerelle entre **données externes hétérogènes** (CSV bancaires multiformats, exports Sage texte semi-structurés, journaux Excel manuels, factures scannées) et le **plan comptable normé** du Module 2 + les **écritures comptables** du Module 4 à venir. Sans cette passerelle, l'adoption en cabinet OHADA est bloquée : ressaisir manuellement plusieurs centaines d'écritures par client est inacceptable.

Ce module a une surface d'attaque sensiblement plus large que les Modules 1-2 (fichiers user-supplied parsés côté serveur). Les choix de design ci-dessous arbitrent volontairement vers la sécurité, l'isolation tenant, et l'idempotence — au prix d'une complexité d'orchestration côté service.

## Goals / Non-Goals

**Goals (vague 1, ce change) :**
- Workflow en sessions explicites avec machine à états traçable.
- Parsing en **table de staging** isolée — aucun écrit dans `accounting_entries` (Module 4 inexistant à ce stade).
- Mapping automatique des colonnes via synonymes français/anglais, ajustable par l'utilisateur.
- Validation ligne par ligne : format date OHADA, signes des montants, balance débit/crédit par pièce, existence du compte dans le plan de l'org, compte est `POSTING` (pas `TITLE`).
- Stockage de fichiers via interface abstraite — driver local en MVP, S3 / Supabase Storage en vague 2.
- Audit complet : 6 nouveaux types d'événements `auth_events`.

**Non-Goals (sortent en vague 2) :**
- Commit vers les écritures réelles (`accounting_entries`) — attendre Module 4.
- OCR fonctionnel — seul le squelette `OcrStatus` est posé.
- Détection de doublons cross-session (un même chèque scanné deux fois).
- Mapping ML / suggestions de comptes basées sur l'historique.
- Frontend wizard d'import — change séparé `module-3b-imports-frontend`.

## Key Decisions

### D1 — Staging table isolée, pas d'écriture directe dans `accounting_entries`

**Décision :** toute ligne parsée atterrit dans `import_staging_entries`, jamais dans une table comptable réelle. Le commit (staging → entries) est une opération distincte qui sortira en vague 2.

**Alternatives écartées :**
- Insert direct dans `accounting_entries` au parse → couplage prématuré avec Module 4, validation devient irréversible (un rollback de session déjà commitée est destructeur).
- Validation en mémoire sans persistance → perd l'historique d'import + impossible de reprendre une session interrompue.

**Conséquence :** une session abandonnée laisse des lignes en staging — un job de nettoyage (vague 2) supprimera les sessions `draft`/`failed` après 30 jours.

### D2 — Stockage abstrait via `DocumentStorage`, driver local par défaut

**Décision :** interface `DocumentStorage` avec deux opérations (`save(input): SaveDocumentResult` et `openReadStream(storageKey)`). Driver MVP `LocalFilesystemDocumentStorage` écrit dans `${DOCUMENTS_STORAGE_DIR}/${orgId}/${storageKey}` où `storageKey` est `${uuid}.${ext}` — uuid = nom de fichier sur disque, jamais le nom utilisateur. Le driver S3 / Supabase Storage arrivera en vague 2 sans changement d'API consommateur.

**Conséquence sécurité :**
- Path traversal impossible : `storageKey` est validé via une regex `^[a-f0-9-]+\.[a-z]{2,5}$` avant tout `path.join`.
- Le `orgId` du path est dérivé du JWT (jamais du nom de fichier utilisateur).
- L'extension est dérivée du MIME validé serveur-side, pas du nom de fichier client (un PDF renommé `.exe` est rejeté).

### D3 — Validation MIME serveur-side, allowlist stricte

**Décision :** la validation des fichiers uploadés se fait via la **magie binaire des premiers octets** (`file-type` lib en vague 2 ; en MVP, vérification du MIME calculé par `multer` + double-check par extension dérivée). Allowlist :

| Capacité | MIME autorisés | Limite taille |
|---|---|---|
| `imports` (CSV/Excel/Sage) | `text/csv`, `text/plain`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel` | 50 MB |
| `documents` (pièces) | `application/pdf`, `image/jpeg`, `image/png`, `text/csv`, `text/plain`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 25 MB |

**Tout MIME hors allowlist retourne `422 DOC_MIME_REJECTED` / `422 IMPORT_UNSUPPORTED_FORMAT`** avant que le fichier ne quitte le tampon mémoire de multer.

### D4 — Hash SHA-256 obligatoire pour deduplication

**Décision :** chaque `import_files` et `documents` carry `sha256` (hex 64 chars). Calculé pendant le streaming d'upload. Une session ne peut pas avoir deux fichiers avec le même hash (rejet `409 IMPORT_FILE_DUPLICATE`).

**Conséquence :** ré-uploader le même CSV bancaire dans la même session est bloqué — défend contre la double-saisie accidentelle. La même hash dans deux sessions DIFFÉRENTES est autorisée (cas légitime : ré-importer le même fichier dans une nouvelle session après abandon).

### D5 — Mapping automatique via synonymes, override utilisateur en vague 2

**Décision :** `MappingService` détecte les colonnes par normalisation (minuscules + suppression accents + suppression espaces) puis lookup contre `HEADER_SYNONYMS` (table figée par `TargetField`). Exemples :
- `Date` / `date` / `dateoperation` / `dateopr` → `TargetField.date`
- `Libellé` / `libelle` / `description` / `narration` → `TargetField.label`
- `Compte` / `accountcode` / `numerocompte` → `TargetField.accountCode`

Si une colonne n'a pas de synonyme connu, elle reste `null` dans le `MappingProposal` et l'utilisateur la mappera manuellement (UI vague 2). Les champs **requis** non mappés (`date`, `accountCode`, au moins l'un de `debit`/`credit`) provoquent une `ValidationError` par ligne au moment du preview.

**Alternative écartée :** mapping par position de colonne (col 0 = date, col 1 = label, …) — trop fragile, varie par banque.

### D6 — Permissions RBAC : `comptable` peut écrire les imports

**Décision :** matrice RBAC pour les 4 nouvelles permissions :

|  | admin | expert_comptable | chef_mission | comptable | auditeur | client_readonly |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `imports.read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `imports.write` | ✓ | ✓ | ✓ | ✓ | | |
| `documents.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `documents.write` | ✓ | ✓ | ✓ | ✓ | | |

**Rationale :** contrairement à `chart_of_accounts.write` (réservé à admin/expert/chef pour discipline), `imports.write` inclut le `comptable` (saisie). Le comptable saisit en masse — c'est son métier. La gouvernance se fait au moment du **commit** des lignes staging vers les écritures réelles (vague 2), pas au moment du parse.

Le `client_readonly` voit ses propres documents (factures qui lui sont rattachées) mais ne peut ni les modifier ni voir les imports du cabinet.

### D7 — Aucun parsing récursif / nested archives

**Décision :** un fichier ZIP / archive est **rejeté** (`422 IMPORT_UNSUPPORTED_FORMAT`). Pas de support batch dans la vague 1. Défense contre les zip-bombs et les archives nichées qui explosent en mémoire.

**Alternative écartée :** dé-zipper les archives et créer une session avec N fichiers — risque trop élevé pour une vague 1 (un seul ZIP malveillant peut saturer le disque). À évaluer en vague 2 avec un sandbox.

### D8 — Parsing XLSX : `sheetRows` limité + désactivation des formules

**Décision :** la lib `xlsx` est connue pour des vulnérabilités prototype-pollution (CVE-2024-22363 + listées non patchées). Mitigations posées :
- `XLSX.read(buffer, { type: 'buffer', sheetRows: 100_000, cellFormula: false, cellHTML: false, cellNF: false })` — limite à 100k lignes par sheet et désactive les évaluateurs de formules / HTML qui sont les vecteurs documentés.
- Le buffer est libéré explicitement après parse (`buffer = null; gc()` n'existant pas en Node sans `--expose-gc`, on s'en remet à la portée de scope).
- À moyen terme (vague 2) : remplacer par `exceljs` (maintenu, pas de prototype pollution connue) ou par un sandbox `worker_thread`.

### D9 — Tenant isolation des fichiers sur disque

**Décision :** structure de stockage `${DOCUMENTS_STORAGE_DIR}/${organizationId}/${storageKey}`. Le `organizationId` vient toujours du JWT (`@CurrentOrg('id')`), jamais d'un input utilisateur. Une lecture par un user de l'org A vers un fichier de l'org B est doublement bloquée : le service vérifie le `organizationId` de l'entité avant d'ouvrir le stream, ET le path résolu ne contient pas le `organizationId` cible.

**Conséquence :** lister le dossier `${DOCUMENTS_STORAGE_DIR}/<orgA-uuid>` ne révèle que les fichiers de l'org A — un opérateur DB peut auditer le respect de l'isolation visuellement.

## Risks

1. **XLSX prototype pollution** — déjà adressé par D8 (sheetRows + flags désactivés). Surveiller le CVE tracker mensuellement ; migrer vers `exceljs` au prochain breaking issue.
2. **DoS par upload répété** — pas de rate-limiting global sur l'upload dans cette vague. Posé comme suivi (issue P2). Mitigation actuelle : limite de taille + RBAC `imports.write`.
3. **CSV formula injection** (`=cmd|'/c calc'`) — les cellules sont parsées en string et stockées en string dans staging ; aucune évaluation côté serveur. Le risque est **côté frontend Excel** quand un utilisateur exporte les lignes — mitigation : préfixer les valeurs commençant par `=`, `+`, `-`, `@` avec un quote `'` au moment de l'export (vague 2, frontend).
4. **Storage filesystem en MVP** — pas de réplication, pas de versioning, pas de chiffrement at-rest. Acceptable pour MVP single-node ; **doit migrer vers S3/Supabase Storage avant le go-live multi-instance** (vague 2).
