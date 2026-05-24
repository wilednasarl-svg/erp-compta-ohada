## 1. Migrations base de données

- [ ] 1.1 Migration `0020_create_accounting_periods.ts` : table + indexes + CHECK status/closed_at cohérence + UNIQUE (org, kind, start_date)
- [ ] 1.2 Migration `0021_create_journals.ts` : table + UNIQUE(org, code) + INDEX(org, kind) + colonne `next_entry_number` DEFAULT 1
- [ ] 1.3 Migration `0022_create_journal_entries.ts` : table + UNIQUE(org, journal, entry_number) + indexes + FK cancels_id self
- [ ] 1.4 Migration `0023_create_journal_entry_lines.ts` : table + CHECK exactement-un-côté + index partiel lettrage
- [ ] 1.5 Migration `0024_create_balance_triggers.ts` : trigger PG `tg_check_journal_entry_balance` + `tg_check_account_is_posting`
- [ ] 1.6 Migration `0025_add_journals_permissions.ts` : 4 nouvelles permissions + matrice rôle (cf. design D6)
- [ ] 1.7 Toutes idempotentes (CREATE EXTENSION IF NOT EXISTS, CREATE OR REPLACE FUNCTION) + symétriques up/down

## 2. Seed journaux par défaut à la création d'org

- [ ] 2.1 Étendre `OrganizationsService.create` (en transaction existante) pour seeder les 5 journaux standards : AC, VE, BQ, CA, OD
- [ ] 2.2 Émettre `journals.entry_created` n'est PAS approprié ici (journaux ≠ écritures) — ajouter un event audit `journals.journal_created` (kind, code, label)
- [ ] 2.3 Test e2e existant `chart-of-accounts-clone.e2e` : ajouter assertion que 5 journaux existent post-create

## 3. Entités TypeORM + repositories

- [ ] 3.1 `AccountingPeriodEntity` + repository (tenant-scopé, méthodes `findContainingDate`, `listByOrg`, `closePeriod`, `reopenPeriod`)
- [ ] 3.2 `JournalEntity` + repository (`findByCode`, `incrementNextEntryNumber` retournant l'ancien atomiquement)
- [ ] 3.3 `JournalEntryEntity` + repository (CRUD scopé, méthodes `findValidatedByPeriod`, `findDraftsByOrg`)
- [ ] 3.4 `JournalEntryLineEntity` + repository (`listByEntry`, `listByAccountAndLetter`)
- [ ] 3.5 Tests unitaires repositories : invariant `assertTenantId`, scope `organization_id` toujours présent

## 4. Service `PeriodsService`

- [ ] 4.1 `createFiscalYear(orgId, year, kind: 'MONTHLY'|'QUARTERLY'|'ANNUAL_ONLY')` — crée l'année + auto-crée les sous-périodes selon kind
- [ ] 4.2 `findContainingDate(orgId, date)` — retourne la période la plus fine ouverte contenant `date`
- [ ] 4.3 `closePeriod(orgId, periodId, actorId, ctx)` — refuse si drafts existent, set status + audit
- [ ] 4.4 `reopenPeriod(orgId, periodId, reason, actorId, ctx)` — `reason` obligatoire, audit avec metadata
- [ ] 4.5 Tests unitaires : refus si drafts, refus si réouverture sans reason, cascade enfants à la clôture année

## 5. Service `JournalsService`

- [ ] 5.1 `seedStandardJournals(orgId, manager: EntityManager)` — appelé dans `OrganizationsService.create` (transaction commune)
- [ ] 5.2 `listForOrg(orgId, { activeOnly? })` — retourne tous les journaux ordonnés par code
- [ ] 5.3 `findByCode(orgId, code)` — 404 si absent
- [ ] 5.4 `createCustomJournal(orgId, { code, label, kind, defaultAccountId? }, actorId, ctx)` — autorise sous-journaux type `BQ-01`
- [ ] 5.5 Tests unitaires : seed 5 journaux exactement, code unique scopé tenant, refus création avec code existant

## 6. Service `EntriesService` — cœur métier

- [ ] 6.1 `createDraft(orgId, input: { journalCode, date, description, reference?, lines: [{accountCode, debit, credit, description? }] }, actorId, ctx)` — assigne entry_number, vérifie période ouverte + balance, statut `draft`
- [ ] 6.2 `validate(orgId, entryId, actorId, ctx)` — passe `draft → validated`, set `validatedAt + validatedBy`, audit
- [ ] 6.3 `cancel(orgId, entryId, reason, actorId, ctx)` — crée une nouvelle entry inverse statut `validated`, pointe `cancels: originalId`, original devient `cancelled`
- [ ] 6.4 `getEntry(orgId, entryId)` — projection EntryView avec lignes
- [ ] 6.5 `listForPeriod(orgId, periodId, { status?, journalCode?, page, pageSize })` — paginé
- [ ] 6.6 `deleteDraft(orgId, entryId, actorId, ctx)` — autorise uniquement si statut `draft`, sinon 409 `JOURNAL_ENTRY_IMMUTABLE`
- [ ] 6.7 Validation des invariants au niveau service (avant le trigger SQL) : équilibre, exactement-un-côté, POSTING, période ouverte
- [ ] 6.8 Tests unitaires : équilibre OK/KO, TITLE rejeté, période fermée rejetée, validation immutable, contre-passation produit bien la pièce inverse

## 7. Service `LetteringService`

- [ ] 7.1 `letter(orgId, lineIds: string[], actorId, ctx)` — vérifie même compte + classe 4 + équilibre + génère lettre + UPDATE atomique
- [ ] 7.2 `unletter(orgId, accountId, letter, actorId, ctx)` — UPDATE atomique line_letter = NULL
- [ ] 7.3 `listLettersForAccount(orgId, accountId)` — agrège par lettre, retourne `{ letter, totalDebit, totalCredit, lineIds }`
- [ ] 7.4 Tests unitaires : lignes de comptes différents rejetées, classe non-4 rejetée, équilibre KO rejeté, génération séquentielle AA/AB/AC

## 8. Intégration Module 3 — `commitSession`

- [ ] 8.1 Étendre `ImportSessionService.commitSession(sessionId, options: { journalCode, period? }, actorId, ctx)`
- [ ] 8.2 Transaction : pour chaque staging row mappée → INSERT JournalEntry (1 par row groupée par référence) + lignes ; statut directement `validated` ; sourceType=`import` ; sourceImportSessionId=`sessionId`
- [ ] 8.3 Si une ligne échoue (équilibre KO, période fermée), rollback total + statut session = `failed`
- [ ] 8.4 Sinon statut session = `committed`, audit `imports.session_committed` (Module 3 ajout) + `journals.batch_committed` (Module 4 ajout)
- [ ] 8.5 Test e2e `imports-commit-to-journal.e2e-spec.ts` : import CSV achats → commit en journal AC → vérifier N entries validées + audit

## 9. Controllers + DTOs

- [ ] 9.1 `JournalsController` (`/organizations/:id/journals/*`) : GET list, GET :code, POST custom (admin only)
- [ ] 9.2 `EntriesController` (`/organizations/:id/entries/*`) : GET list (paginé filtré période/journal/statut), GET :id, POST draft, POST :id/validate, POST :id/cancel, DELETE :id (drafts only)
- [ ] 9.3 `LetteringController` (`/organizations/:id/lettering/*`) : POST letter, POST unletter, GET account/:accountId
- [ ] 9.4 `PeriodsController` (`/organizations/:id/accounting-periods/*`) : GET list, POST create-year, POST :id/close, POST :id/reopen
- [ ] 9.5 DTOs class-validator stricts (Min/Max sur montants, dates ISO, code journal pattern `^[A-Z0-9-]{1,8}$`)
- [ ] 9.6 Swagger : `@ApiTags`, `@ApiBearerAuth` sur tous les endpoints

## 10. Frontend Next.js

- [ ] 10.1 Page `/journals` : liste des 5 journaux avec dernière date d'écriture + nb d'entries
- [ ] 10.2 Page `/journals/:code/new` : formulaire écriture avec table de lignes ajout/suppression, validation live de l'équilibre, AccountPicker filtré POSTING+actif
- [ ] 10.3 Page `/entries/:id` : détail lignes + boutons "Valider" (si draft) / "Contre-passer" (si validated) / "Supprimer" (si draft)
- [ ] 10.4 Page `/accounting-periods` : liste des périodes avec status badge, bouton "Clôturer" pour admin/expert
- [ ] 10.5 Modal de lettrage : sélectionner lignes débit + crédit, affichage solde, bouton "Lettrer" actif si équilibré
- [ ] 10.6 Sidebar : ajouter "Journaux" + "Périodes" liens
- [ ] 10.7 Types `apps/frontend/src/types/journals.ts` mirroirs des views backend

## 11. Tests e2e

- [ ] 11.1 `journals-create-validate-cancel.e2e-spec.ts` — cycle complet d'une écriture
- [ ] 11.2 `journals-balance-invariant.e2e-spec.ts` — POST déséquilibré 422 ; INSERT direct via dataSource bypassant le service → trigger lève
- [ ] 11.3 `journals-period-closed.e2e-spec.ts` — clôture période, tentative POST entry dans période fermée → 422 ; réouverture avec reason ; re-POST OK
- [ ] 11.4 `journals-numbering-sequential.e2e-spec.ts` — N entries séquentielles, pas de trou, suppression d'une draft ne casse pas le compteur
- [ ] 11.5 `journals-lettering.e2e-spec.ts` — lettrer 2 lignes équilibrées 401, listLetters retourne le groupe, unletter reset
- [ ] 11.6 `journals-import-commit.e2e-spec.ts` — Module 3 + Module 4 : import CSV → commit → entries validées dans le bon journal
- [ ] 11.7 `journals-tenant-isolation.e2e-spec.ts` — org A ne peut pas créer/lire/contre-passer entries org B
- [ ] 11.8 `journals-permissions.e2e-spec.ts` — comptable peut write + validate via `journals.write` + `journals.validate` ; auditeur read only ; close_period réservé admin+expert
- [ ] 11.9 Coverage ≥ 80%

## 12. Documentation

- [ ] 12.1 `docs/journals.md` : modèle (journal → entry → line), invariants, lettrage, périodes, contre-passation, exemples curl
- [ ] 12.2 Étendre `docs/error-codes.md` avec les codes Module 4 (`JOURNAL_ENTRY_UNBALANCED`, `JOURNAL_ENTRY_NON_POSTING_ACCOUNT`, `JOURNAL_ENTRY_PERIOD_CLOSED`, `JOURNAL_ENTRY_IMMUTABLE`, `LETTERING_DIFFERENT_ACCOUNTS`, `LETTERING_UNBALANCED`, `PERIOD_HAS_DRAFTS`, `PERIOD_NOT_FOUND`)
- [ ] 12.3 Étendre `docs/rbac.md` avec les 4 nouvelles permissions journals.*
- [ ] 12.4 README backend : mentionner migrations 0020-0025

## 13. Pre-merge

- [ ] 13.1 `pnpm --filter backend test` ≥ 80% coverage
- [ ] 13.2 `pnpm lint` + `pnpm build` backend + frontend clean
- [ ] 13.3 `openspec status --change module-4-journals-entries` → isComplete: true
- [ ] 13.4 Audit `security-reviewer` agent (focus : équilibre bypassable ? numéro de pièce predictable ? période fermée contournable via SQL injection des dates ?)
- [ ] 13.5 Audit `code-reviewer` agent (focus : transactionnalité de la séquence next_entry_number, atomicité des triggers, performance lettrage sur gros compte 411 avec 50k lignes)
