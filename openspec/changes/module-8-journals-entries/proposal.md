## Why

Module 1 a livré le socle multi-tenant, Module 2 le plan comptable OHADA, Module 3 le moteur d'imports vers staging. Tous trois sont en place sans qu'**aucune écriture comptable réelle** ne puisse encore être posée — le staging Module 3 attend une cible (`commitSession` vague 2) qui exige des journaux et des écritures double-partie. Sans Module 4, la plateforme reste une coquille : pas de grand livre (Module 5), pas de balance, pas d'états financiers (Module 6), pas de TVA (Module 11), pas de retraitements de fin d'exercice.

Module 4 pose le cœur comptable SYSCOHADA : **journaux** (achats / ventes / banque / caisse / OD), **écritures** double-partie avec validation d'équilibre débit=crédit, **lettrage** (réconciliation client/fournisseur), **clôture / réouverture périodique** (mensuelle, trimestrielle, annuelle), **séquence chronologique** par journal (numéro de pièce immutable).

## What Changes

- Introduction de 4 entités principales : `Journal` (carnet par type), `JournalEntry` (en-tête : date, libellé, journal, période), `JournalEntryLine` (ligne d'écriture : compte, débit OU crédit, libellé, lettrage facultatif), `AccountingPeriod` (exercice + période — mois, trimestre, exercice complet — avec statut `open` / `closed`).
- **Invariant comptable absolu** : pour toute `JournalEntry`, `SUM(lines.debit) === SUM(lines.credit)` au cent près (montants en `DECIMAL(15,2)`). Refuser un POST déséquilibré avec `JOURNAL_ENTRY_UNBALANCED` (422).
- **Invariant cible POSTING** : chaque ligne référence un `organization_chart_accounts.id` dont `account_type === 'POSTING'`. Tentative sur TITLE → `JOURNAL_ENTRY_NON_POSTING_ACCOUNT` (422).
- **Invariant période ouverte** : refuser tout écriture dont `date` tombe dans une période `closed`. Pas de réouverture API — c'est une procédure admin via une commande dédiée auditée.
- **Lettrage** : champ `lineLetter` (varchar(4) NULL) sur `JournalEntryLine` permet de regrouper les lignes débit/crédit d'un même compte tiers qui s'équilibrent. Endpoint `POST /journals/letter` qui prend une liste de `lineIds`, vérifie l'équilibre, assigne une lettre (`AA`, `AB`, ...). Endpoint inverse `POST /journals/unletter`.
- **Séquencement** : chaque journal a son propre compteur `next_entry_number` ; chaque `JournalEntry` reçoit `entryNumber` (`int`) immutable à la création. Pas de trou autorisé (refuser DELETE sur une entry validée — soft-delete via `cancelled_at` ou écriture inverse de contre-passation).
- **Statut d'écriture** : `draft` (modifiable, supprimable) → `validated` (immutable sauf contre-passation) → `cancelled` (contre-passée par une autre écriture qui pointe `cancels: <id>`).
- Endpoints REST sous `/organizations/:id/journals/*` et `/organizations/:id/entries/*` (lecture, création, validation, contre-passation, lettrage).
- Intégration Module 3 : `commitSession(sessionId)` consomme les staging rows et produit des écritures dans le journal cible spécifié à la création de la session.
- Audit unifié : `journals.entry_created`, `journals.entry_validated`, `journals.entry_cancelled`, `journals.letter_assigned`, `journals.period_closed`, `journals.period_reopened`.

## Capabilities

### New Capabilities
- `journals`: journaux comptables (catalogue), écritures double-partie avec invariant d'équilibre, lettrage des tiers, périodes comptables et clôture/réouverture, contre-passation. Intégration `commitSession` pour Module 3.

### Modified Capabilities
- `accounting-plan`: les comptes du plan d'organisation acquièrent la notion "compte mouvementé" (au moins une `JournalEntryLine` valide pointe dessus). La promotion `POSTING → TITLE` (ajout d'un sous-compte sous un compte déjà mouvementé) est désormais bloquée avec `CHART_ACCOUNT_HAS_POSTINGS` (409) — invariant promis dès Module 2 (D4) mais réellement enforced ici. La suppression d'un compte custom mouvementé devient elle aussi 409.
- `rbac`: 4 nouvelles permissions — `journals.read` (tous rôles métier), `journals.write` (Admin, Expert-comptable, Chef de mission, Comptable), `journals.validate` (Admin, Expert-comptable, Chef de mission — l'écriture validée devient immutable), `journals.close_period` (Admin + Expert-comptable seulement — clôture périodique).

## Impact

- **Code backend (NestJS)** : nouveau module `journals/` (entités `JournalEntity`, `JournalEntryEntity`, `JournalEntryLineEntity`, `AccountingPeriodEntity` ; services `JournalsService`, `EntriesService`, `LetteringService`, `PeriodsService` ; controllers + DTOs ; au moins 6 commandes / 6 queries au sens CQRS lite).
- **Base de données PostgreSQL** : 4 nouvelles tables + 2 séquences (`seq_journal_entry_number_per_journal` non — c'est une colonne `next_entry_number` sur `journals` qu'on incrémente en transaction). Migrations `0020_create_accounting_periods`, `0021_create_journals`, `0022_create_journal_entries`, `0023_create_journal_entry_lines`. Index composites obligatoires : `(organization_id, journal_id, entry_number)` UNIQUE, `(organization_id, period_id)`, `(organization_id, account_id, line_letter)` partiel WHERE letter IS NOT NULL.
- **Frontend (Next.js 15)** : 3 nouvelles pages — `/journals` (liste journaux + dernières écritures), `/journals/:journalCode/new` (formulaire écriture avec validation d'équilibre live), `/entries/:entryId` (détail + bouton validation / contre-passation). Component `<AccountPicker>` qui filtre sur POSTING uniquement.
- **Module 3 intégration** : `ImportSessionService.commitSession` devient une vraie méthode (déblocage tâche 8.7 du plan Module 3).
- **Modules dépendants** : Module 5 (Balance & Grand Livre) agrège par `journal_entry_lines` → `organization_chart_accounts`. Module 6 (États financiers) projette en bilan + compte de résultat. Module 11 (TVA) lit les comptes 4431-4456. Module 13 (Clôture annuelle) appellera `closePeriod` sur l'exercice complet.
- **Sécurité** : aucune nouvelle surface réseau au-delà des endpoints documentés. Toutes les mutations passent par `TenantGuard` + `PermissionsGuard` du Module 1.
