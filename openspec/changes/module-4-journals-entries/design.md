## Context

Module 4 livre le cœur comptable : journaux + écritures double-partie. Toutes les décisions ici figent la sémantique des modules 5 (Balance / Grand Livre), 6 (États financiers AUDCIF), 11 (TVA), 13 (Clôture annuelle). Une erreur sur l'invariant d'équilibre ou sur l'immutabilité d'une écriture validée a un coût de migration énorme.

Le SYSCOHADA AUDCIF impose :
1. comptabilité d'engagement (sauf Système Minimal de Trésorerie — Module 2 D2) ;
2. principe de la **partie double** : toute opération mouvemente au moins deux comptes, somme débits = somme crédits ;
3. **chronologie** stricte par journal : numéro de pièce séquentiel, immutable ;
4. **piste d'audit** : aucune écriture validée ne peut être modifiée — seule la contre-passation (écriture inverse) corrige une erreur ;
5. **clôture périodique** : un exercice clôturé n'accepte plus d'écriture avec date dans la période.

## Goals / Non-Goals

**Goals:**
- Modèle de données 1-N-N : `Journal` → `JournalEntry` → `JournalEntryLine`, avec invariant d'équilibre enforced en transaction.
- 5 journaux SYSCOHADA standard seedés à la création d'org : `AC` (Achats), `VE` (Ventes), `BQ` (Banque), `CA` (Caisse), `OD` (Opérations Diverses). L'org peut ajouter des sous-journaux (`BQ-01`, `BQ-02` pour plusieurs banques).
- Validation d'équilibre côté SQL (CHECK trigger) ET côté service (avant INSERT). Belt-and-braces.
- Statut machine : `draft` → `validated` → (optionnellement) `cancelled`. Seul `draft` est éditable.
- Lettrage (réconciliation client/fournisseur) — assigner une lettre (`AA`, `AB`, …) à un groupe de lignes équilibrées sur un compte tiers (classe 4).
- Périodes comptables (`AccountingPeriod`) : un exercice est une période parent qui contient 12 périodes mois, ou 4 trimestres + 1 annuelle, selon le découpage choisi par l'org. Statut `open` / `closed` par période. Clôturer la période annuelle clôture les périodes enfants.
- Contre-passation : une nouvelle entry avec `cancels: <originalEntryId>` qui produit automatiquement les lignes inverses. L'original passe à `cancelled` ; il reste lisible.
- Intégration Module 3 : `commitSession(sessionId)` consomme staging → entries.

**Non-Goals:**
- Multi-devises (FCFA / EUR / USD sur la même écriture) — vague 2.
- Écritures analytiques (classe 9 ventilation par centre de coût) — Module 12.
- Workflow d'approbation multi-niveaux (chef de mission valide, expert-comptable signe) — Module 14 (Workflow & Signatures).
- Recodification (changer le numéro de pièce a posteriori) — interdit par AUDCIF.
- Export FEC (Fichier des Écritures Comptables) — Module 6 (États financiers + exports réglementaires).
- Lettrage automatique par algorithme (matcher montants identiques) — vague 2. Vague 1 : lettrage manuel uniquement.

## Decisions

### D1. Montants en `DECIMAL(15,2)`, jamais en flottant

**Choix** : colonnes `debit` et `credit` en `DECIMAL(15,2)` côté PG, mapping TypeORM `'numeric'` → string côté entité, conversion via une lib lib (`decimal.js` ou `big.js`) au niveau service.

**Raisonnement** : 15 chiffres = couvre des montants jusqu'à 9 999 999 999 999,99 FCFA (10 milliards de milliards FCFA). 2 décimales = arrondi au centime. Aucune entité ivoirienne ne dépasse cette plage en pratique. Un float64 IEEE-754 reproduit 0,1 + 0,2 = 0,30000000000000004 → inacceptable pour la comptabilité.

### D2. Invariant d'équilibre — enforced à 3 niveaux

1. **Service `EntriesService.create`** : calcule la somme des lignes avant `INSERT` et rejette avec `JOURNAL_ENTRY_UNBALANCED` (422) si ≠.
2. **Trigger PG `tg_check_journal_entry_balance`** : `AFTER INSERT OR UPDATE ON journal_entry_lines, FOR EACH STATEMENT` qui recalcule `SUM(debit) = SUM(credit)` pour l'entry parent. Si violation, `RAISE EXCEPTION` → la transaction rollback.
3. **Test e2e** : un POST déséquilibré via le HTTP layer doit retourner 422, ET un INSERT manuel via `dataSource.query(...)` qui contourne le service doit lever l'exception trigger.

**Raisonnement** : un humain qui édite un fichier de migration ou qui touche la DB en direct ne peut pas casser l'invariant. Le service est la première ligne (UX cleaner — 422 avec message); le trigger est le garde-fou.

### D3. Numéro de pièce séquentiel par journal, immutable

**Choix** : table `journals` a une colonne `next_entry_number INT NOT NULL DEFAULT 1`. À chaque `INSERT INTO journal_entries`, le service fait dans la même transaction :

```sql
UPDATE journals SET next_entry_number = next_entry_number + 1
  WHERE id = $1 AND organization_id = $2
  RETURNING next_entry_number - 1 AS assigned_number;
```

Le numéro assigné est inscrit dans `journal_entries.entry_number`. Aucun endpoint API ne modifie `next_entry_number` (sauf re-numérotation lors de clôture — Module 13).

**Pourquoi pas un `BIGSERIAL` ou une `SEQUENCE` PG** : une séquence est globale (non par-tenant ET non par-journal). Recréer N séquences (`seq_org_X_journal_AC`, …) explose en complexité opérationnelle. La colonne `next_entry_number` est simple, transactionnellement correcte, et inspectable.

**Pourquoi "pas de trou"** : SYSCOHADA exige une séquence stricte. La suppression d'une entry validée est interdite (le service refuse). Si on doit annuler, on fait une contre-passation : la pièce N reste, on ajoute la pièce N+1 qui annule N (libellé "Annulation de la pièce N").

### D4. Trois statuts d'écriture + contre-passation

```
draft  →  validated  →  cancelled
                   ↘  (terminal, jamais réouvrable)
```

- `draft` : modifiable, supprimable. Visible uniquement par l'auteur et les rôles avec `journals.write`.
- `validated` : immutable. Visible par tous les rôles avec `journals.read`. Comptabilisé dans la balance.
- `cancelled` : l'entry existe encore (audit trail) mais ses montants sont annulés par la pièce inverse (`cancels: <originalId>`).

Le service `EntriesService.cancel(entryId, reason)` crée une nouvelle entry avec :
- même journal,
- même période (sauf si elle est clôturée — dans ce cas, période courante),
- date = aujourd'hui,
- libellé `"Annulation de la pièce N° X — {reason}"`,
- lignes inversées (débits ↔ crédits),
- champ `cancels: originalId`,
- statut directement `validated` (jamais en draft).

L'original passe à `cancelled` et reçoit `cancelledBy: newEntryId`.

### D5. Périodes comptables + clôture

**Modèle** : `AccountingPeriod(id, organizationId, parentId NULL, kind: 'YEAR'|'QUARTER'|'MONTH', startDate, endDate, status: 'open'|'closed', closedAt, closedBy)`.

À la création d'un exercice (`POST /accounting-periods` avec `kind: YEAR`), le service crée automatiquement les 12 périodes mois enfants. Le découpage trimestriel est facultatif (créé sur demande).

**Invariant période ouverte** : `EntriesService.create` lookup la période qui contient `entry.date` (la plus fine : MONTH si elle existe, sinon QUARTER, sinon YEAR) et refuse si `status === 'closed'` → `JOURNAL_ENTRY_PERIOD_CLOSED` (422).

**Clôture** : `POST /accounting-periods/:id/close` (permission `journals.close_period`) :
1. vérifie que toutes les entries `draft` dans la période sont validées OU supprimées (sinon 409 `PERIOD_HAS_DRAFTS`) ;
2. set `status = 'closed'`, `closedAt = now()`, `closedBy = actorId` ;
3. émet `journals.period_closed` dans l'audit.

**Réouverture** : `POST /accounting-periods/:id/reopen` (même permission) avec un champ `reason` obligatoire qui finit en metadata audit. Aucune réouverture silencieuse — c'est un événement majeur.

### D6. Lettrage — varchar(4) "AA" à "ZZ" (676 lettres / compte)

**Choix** : colonne `line_letter CHAR(4) NULL` sur `journal_entry_lines`. Index partiel `(organization_id, account_id, line_letter) WHERE line_letter IS NOT NULL`.

L'endpoint `POST /journals/letter` accepte une liste de `lineIds` :
1. vérifie qu'ils pointent tous le même compte (sinon 422 `LETTERING_DIFFERENT_ACCOUNTS`) ;
2. vérifie que ce compte est en classe 4 (sinon 422 — le lettrage n'a de sens que pour les comptes tiers) ;
3. vérifie que `SUM(debit) === SUM(credit)` sur le groupe (sinon 422 `LETTERING_UNBALANCED`) ;
4. génère la prochaine lettre disponible sur ce compte (`AA`, `AB`, …, `AZ`, `BA`, …, `ZZ`) ;
5. UPDATE atomique.

**Inverse** : `POST /journals/unletter` avec `letter: 'AB'` set tous les `line_letter = NULL` pour ce compte+lettre.

**Pourquoi varchar(4) et pas (2)** : SYSCOHADA accepte des lettres composées (`AAA` ou `AAAA`) sur les gros comptes très utilisés. 4 chars = 456 976 lettres possibles, on n'épuisera jamais.

### D7. Séquence des sources d'écriture

Une écriture peut venir de :

| Source | Champ `sourceType` | Référence |
|--------|--------------------|-----------|
| Saisie manuelle UI | `'manual'` | NULL |
| Import (Module 3) | `'import'` | `sourceImportSessionId` (FK) |
| Contre-passation | `'reversal'` | `cancels` (FK même table) |
| Future : OD automatique (TVA mensuelle, amortissements) | `'auto'` | `sourceJobId` (FK module futur) |

Le tracking est crucial pour le diagnostic : "pourquoi cette ligne est apparue dans le grand livre ?".

### D8. Modèle de données

```
accounting_periods (
  id              UUID PK DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL FK → organizations(id) ON DELETE CASCADE,
  parent_id       UUID NULL FK → accounting_periods(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('YEAR','QUARTER','MONTH')),
  label           TEXT NOT NULL,              -- "2026", "T1 2026", "2026-01"
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at       TIMESTAMPTZ NULL,
  closed_by       UUID NULL FK → users(id),
  reopen_reason   TEXT NULL,                  -- last reopen reason, audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
)
INDEX (organization_id, start_date, end_date)
UNIQUE (organization_id, kind, start_date)

journals (
  id              UUID PK DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL FK → organizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,              -- 'AC', 'VE', 'BQ', 'CA', 'OD', or org-custom
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('PURCHASES','SALES','BANK','CASH','MISC')),
  default_account_id UUID NULL FK → organization_chart_accounts(id),  -- e.g. BQ default 521
  next_entry_number INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
)
INDEX (organization_id, kind)

journal_entries (
  id              UUID PK DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL FK → organizations(id) ON DELETE CASCADE,
  journal_id      UUID NOT NULL FK → journals(id) ON DELETE RESTRICT,
  period_id       UUID NOT NULL FK → accounting_periods(id) ON DELETE RESTRICT,
  entry_number    INT NOT NULL,               -- immutable, sequential per journal
  entry_date      DATE NOT NULL,
  description     TEXT NOT NULL,
  reference       TEXT NULL,                  -- external ref (invoice number, etc.)
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','cancelled')),
  source_type     TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','import','reversal','auto')),
  source_import_session_id UUID NULL FK → import_sessions(id),
  cancels_id      UUID NULL FK → journal_entries(id),     -- this entry cancels another
  cancelled_by_id UUID NULL FK → journal_entries(id),     -- this entry was cancelled BY another
  validated_at    TIMESTAMPTZ NULL,
  validated_by    UUID NULL FK → users(id),
  cancelled_at    TIMESTAMPTZ NULL,
  created_by      UUID NOT NULL FK → users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, journal_id, entry_number)
)
INDEX (organization_id, period_id),
INDEX (organization_id, journal_id, entry_date DESC),
INDEX (organization_id, status)

journal_entry_lines (
  id              UUID PK DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,              -- denormalised for index efficiency
  entry_id        UUID NOT NULL FK → journal_entries(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL FK → organization_chart_accounts(id) ON DELETE RESTRICT,
  line_index      INT NOT NULL,               -- order within the entry (1, 2, 3…)
  debit           DECIMAL(15,2) NOT NULL DEFAULT 0,
  credit          DECIMAL(15,2) NOT NULL DEFAULT 0,
  description     TEXT NULL,                  -- per-line label
  line_letter     CHAR(4) NULL,               -- lettering reconciliation
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0))   -- exactly one side
)
INDEX (organization_id, entry_id, line_index)
INDEX (organization_id, account_id, line_letter) WHERE line_letter IS NOT NULL
```

Trigger PG `tg_check_journal_entry_balance` après `INSERT OR UPDATE OR DELETE` sur `journal_entry_lines` : recalcule `SUM(debit) = SUM(credit)` pour l'entry parent et `RAISE EXCEPTION` si violation.

Trigger PG `tg_check_account_is_posting` à l'insertion d'une ligne : vérifie que le `organization_chart_accounts.account_type = 'POSTING'` et `is_active = true`. Raise sinon.

## Risks / Trade-offs

- **[Performance trigger d'équilibre]** : sur des entries à 50+ lignes, le trigger recalcule à chaque INSERT. Mitigation : INSERT en batch (`COPY` ou multi-row INSERT), trigger `FOR EACH STATEMENT` (déjà choisi en D2). À monitorer en charge — un cabinet typique poste 50-500 entries/jour, c'est trivial.
- **[Numéro de pièce immutable + suppression]** : un utilisateur va inévitablement vouloir "supprimer la pièce 42" pour ré-utiliser le numéro. Le service refuse — UX doit clairement expliquer "contre-passez plutôt". Risque de friction utilisateur, accepté car non-négociable par AUDCIF.
- **[Période clôturée + correction d'erreur]** : si on découvre une erreur dans la période 2025-03 alors qu'on est en 2026-02, on doit soit (a) réouvrir 2025-03 (audit trail visible), soit (b) faire la correction en 2026-02 avec libellé "Correction sur exercice 2025". Module 4 expose les deux. Le commissaire aux comptes préfère (b) ; (a) reste possible avec `reason` obligatoire.
- **[Lettrage automatique non livré]** : vague 1 manuel uniquement → friction. Vague 2 ajoutera un matcher d'algorithme (montants identiques opposés sur compte tiers). Accepté pour MVP.
- **[Multi-devise différé]** : un cabinet ivoirien qui gère un client zone EUR (par exemple un dossier de filiale française) ne peut pas saisir directement en EUR. Workaround : saisir en FCFA équivalent au cours du jour, traçabilité dans `description`. Vague 2 ajoutera le multi-devise propre.
- **[Backup / point-in-time recovery]** : la table `journal_entries` est append-mostly (update rare sur draft, jamais sur validated). PITR Supabase 7 jours doit suffire pour reverse une catastrophe ; à monitorer.
- **[Migration v0.3 → v0.4]** : la table `import_sessions` (Module 3) gagne un champ `committed_entry_ids` (ARRAY) ou une FK inverse via une table de liaison `import_session_entries`. À décider en codage Module 4 — voir tasks.md 8.
