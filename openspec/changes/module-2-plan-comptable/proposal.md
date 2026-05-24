## Why

Le Module 1 a posé les fondations multi-tenant (auth, organisations, RBAC, MFA, audit). Avant d'introduire les journaux, les écritures, la balance, le grand livre ou les états financiers, la plateforme doit disposer d'un **plan comptable structuré conforme au SYSCOHADA révisé (AUDCIF, applicable depuis le 1ᵉʳ janvier 2018)**. Aujourd'hui, les cabinets et PME de l'espace OHADA gèrent leur plan comptable dans Excel ou recopient celui d'un client à l'autre — sans contrôle d'unicité, sans validation des classes/sens normal, sans distinction comptes de titre vs comptes mouvementables. Le plan comptable est la colonne vertébrale dont dépend chaque module métier ultérieur : aucune écriture, aucun import bancaire, aucun rapport ne peut être implémenté sans un référentiel de comptes fiable, isolé par organisation, et adossé au plan officiel OHADA.

## What Changes

- Introduction d'un **plan comptable de référence OHADA** (lecture seule, partagé entre toutes les organisations), seedé depuis le SYSCOHADA AUDCIF officiel pour les trois systèmes (Normal, Minimal de Trésorerie, Allégé).
- Introduction d'un **plan comptable par organisation** : à la création d'une organisation, le système d'écriture (Normal / Minimal / Allégé) est figé ; le plan de référence correspondant est cloné en plan personnalisable. L'org peut ensuite ajouter des sous-comptes (4–10 chiffres) sous n'importe quel compte divisionnaire existant, désactiver des comptes inutiles, et modifier les libellés — sans pouvoir altérer la structure des comptes principaux normés (classes 1–9, racines à 2 chiffres).
- Distinction **comptes de titre** (nœuds non mouvementables) vs **comptes terminaux** (feuilles, seules autorisées dans les écritures du Module 3).
- Invariants comptables enforced : `code` immutable une fois créé, sens normal (D/C) dérivé de la classe, hiérarchie strictement préfixée (`411` ⊂ `41` ⊂ `4`), désactivation hard si jamais mouvementé.
- Endpoints REST sous `/organizations/:id/chart-of-accounts/*` (lecture, ajout, modification, désactivation) + endpoint public `/reference-chart-of-accounts?system=NORMAL|MINIMAL|ALLEGE` pour la consultation du référentiel.
- Permissions RBAC ajoutées au catalogue Module 1 : `chart_of_accounts.read` (tous rôles métier) et `chart_of_accounts.write` (Admin, Expert-comptable, Chef de mission, Comptable).
- Audit trail : événements `chart_of_accounts.imported`, `chart_of_accounts.account_created`, `chart_of_accounts.account_updated`, `chart_of_accounts.account_deactivated` (table `auth_events` étendue, codes documentés).

## Capabilities

### New Capabilities
- `accounting-plan`: plan comptable de référence OHADA (immuable), plan comptable par organisation (clone personnalisable lié à un système comptable normal/minimal/allégé), CRUD comptes terminaux, validation des invariants SYSCOHADA AUDCIF.

### Modified Capabilities
- `rbac`: extension du catalogue de permissions avec `chart_of_accounts.read` et `chart_of_accounts.write` + ajout aux 6 rôles métier selon la matrice.
- `organizations`: à la création d'une organisation, choix obligatoire du système comptable (`NORMAL` | `MINIMAL` | `ALLEGE`) ; déclenche l'import du plan de référence correspondant en plan personnalisable.

## Impact

- **Code backend (NestJS)** : nouveau module `accounting-plan/` (entités `ReferenceAccount`, `OrganizationAccount`, `OrganizationAccountingConfig`, services `ChartOfAccountsService`, `ReferenceChartService`, repositories scopés tenant, controllers + DTOs).
- **Base de données PostgreSQL** : 3 nouvelles tables (`reference_chart_accounts`, `organization_chart_accounts`, `organization_accounting_configs`) + extension de la table `organizations` avec un FK vers `organization_accounting_configs` (1-1). Seed initial du plan de référence pour les trois systèmes (≈800 comptes pour le Normal, ≈400 pour le Minimal, ≈600 pour l'Allégé).
- **Frontend (Next.js 15)** : nouvelle section `/organizations/:id/chart-of-accounts` (arbre hiérarchique, recherche, ajout de sous-compte, modification de libellé, désactivation), ainsi qu'un step "système comptable" dans le wizard de création d'organisation (`/organizations/new`).
- **Dépendances** : aucune nouvelle dépendance backend (parsing du seed = TS pur). Côté frontend, ajout potentiel de `react-arborist` ou `@tanstack/react-table` pour l'arborescence (à confirmer dans `design.md`).
- **Sécurité** : le `TenantGuard` du Module 1 garantit l'isolation des plans par organisation ; aucun nouveau guard à écrire. Le plan de référence est read-only globalement (pas d'endpoint d'écriture côté API).
- **Modules dépendants** : Module 3 (Journaux & écritures) dépendra de `OrganizationAccount.id` comme cible d'écriture ; Module 4 (Balance & Grand Livre) agrégera par compte ; Module 5 (États financiers) projettera par classe/poste OHADA.
