## Context

Le Module 1 a livré le socle multi-tenant (organisations, RBAC, MFA, audit). Aucune écriture comptable n'est encore possible — pour cela il faut d'abord un **plan comptable** : un référentiel de comptes que les écritures viendront mouvementer. Le SYSCOHADA AUDCIF révisé (applicable depuis le 1ᵉʳ janvier 2018 dans les 17 États OHADA, dont la Côte d'Ivoire) est la norme obligatoire. Il définit trois systèmes comptables possibles : **Normal** (PME et grandes entreprises, chiffre d'affaires > seuils), **Minimal de Trésorerie** (très petites entités, comptabilité d'encaissement), et **Allégé** (entités intermédiaires). Chaque système expose un sous-ensemble du plan comptable général.

Ce module pose la couche données et CRUD pour ce référentiel. Aucune logique d'écriture, de validation d'équilibre, de journal ou de balance ici — ces capacités viendront aux Modules 3 et 4.

## Goals / Non-Goals

**Goals:**
- Stocker le plan comptable OHADA officiel comme **plan de référence** (read-only, partagé entre toutes les organisations), seedé via migration TypeORM à partir d'un fichier TS structuré.
- Cloner ce référentiel en un **plan personnalisable par organisation** lors du choix du système comptable (Normal / Minimal / Allégé).
- Permettre à une organisation d'**ajouter des sous-comptes** (codes plus longs) sous n'importe quel compte divisionnaire existant, sans pouvoir modifier les comptes principaux normés.
- Distinguer **comptes de titre** (`account_type = TITLE`, non mouvementables, jamais cibles d'écriture) des **comptes terminaux** (`account_type = POSTING`, feuilles, seules autorisables par le Module 3).
- Garantir les invariants comptables : `code` immutable, sens normal (D/C) cohérent avec la classe OHADA, hiérarchie préfixée stricte (un compte `4111` doit avoir `411` comme parent direct, qui doit avoir `41` comme parent, qui doit avoir `4` comme racine).
- Désactivation soft (`is_active = false`) si un compte a été mouvementé (sera détecté par le Module 3) — pour le Module 2 lui-même, qui ne connaît pas encore les écritures, la suppression est autorisée tant que le compte n'a pas d'enfants actifs.

**Non-Goals:**
- Logique d'écriture, de journal, de validation débit/crédit — Module 3.
- Balance, grand livre, états financiers — Module 4 et 5.
- Plans comptables non-OHADA (PCG français, IFRS, US GAAP) — non MVP.
- Plan comptable bancaire OHADA (PCEC) ou plan d'assurance — non MVP.
- Import depuis un fichier CSV/Excel d'un plan préexistant — sortira d'une change ultérieure si besoin.
- Multi-devises au niveau des comptes (chaque compte ouvert dans plusieurs devises) — Module ultérieur.
- Liaison comptes ↔ rubriques d'états financiers (SYSCOHADA AUDCIF tableaux 1-6) — Module 5 (États financiers).

## Decisions

### D1. Deux tables physiques distinctes : `reference_chart_accounts` (global) et `organization_chart_accounts` (par tenant)

**Choix** : deux tables séparées plutôt qu'une seule avec `organization_id` nullable.

**Raisonnement** :
- Le plan de référence est immuable, partagé, et probablement consulté par les outils tiers (futur SDK, export OHADA). Le séparer rend les requêtes simples (`SELECT * FROM reference_chart_accounts WHERE system = 'NORMAL'`) et évite tout doute sur la sémantique d'un `organization_id IS NULL`.
- Le plan d'organisation est mutable, scopé tenant, et soumis au `TenantGuard` Module 1. Il doit obligatoirement porter `organization_id NOT NULL` pour bénéficier des index composites et des invariants d'isolation déjà éprouvés.
- Lors du clonage initial (à la création de l'org), on copie ligne par ligne `reference_chart_accounts` → `organization_chart_accounts` avec `reference_account_id` comme FK informative (NULL si l'org a créé un sous-compte custom).

**Conséquence** : doublement des lignes en base (≈ 800 lignes par org pour le Normal), acceptable au regard du coût des écritures futures qui dépasseront vite ce volume.

### D2. Système comptable fixé à la création de l'organisation, immutable

**Choix** : le système (`NORMAL` | `MINIMAL` | `ALLEGE`) est choisi au moment de la création de l'organisation (Module 1 → wizard `/organizations/new`), stocké dans une table `organization_accounting_configs(organization_id PK, system, created_at)`, et **ne peut plus être modifié ensuite**. Changer de système une fois des écritures saisies serait une opération de migration comptable complexe — hors scope MVP.

**Conséquence** : le wizard de création d'organisation du Module 1 est étendu (étape supplémentaire), et le clonage du plan de référence est déclenché en transaction lors du `POST /organizations` (`create org → create accounting config → clone reference plan`). Un endpoint `POST /organizations/:id/chart-of-accounts/import` est exposé en plus pour le cas dégradé (org créée avant l'extension du wizard, ou clonage initial qui aurait échoué).

### D3. Codes comptables : chiffres uniquement, longueur 2 à 10, parent dérivé par préfixe

**Choix** : `code` matchant `/^\d{2,10}$/`. La hiérarchie n'est PAS stockée dans une colonne `parent_id` matérialisée pour le plan de référence (où elle est figée), mais l'est pour le plan d'organisation où l'utilisateur peut ajouter des sous-comptes (nécessite pouvoir vérifier rapidement "ce code 411001 a-t-il bien `411` comme parent existant et actif ?").

**Implémentation** :
- Table de référence : `(code, label, class, account_type, normal_balance, applicable_systems)`. Pas de `parent_id` : la hiérarchie est dérivée à la volée par préfixe (`code LIKE '41%' AND length(code) = 3`).
- Table d'organisation : `(id, organization_id, code, label, class, account_type, normal_balance, parent_id NULL, reference_account_id NULL, is_active, created_at, updated_at)`. `parent_id` est NULL pour les racines, sinon FK vers `organization_chart_accounts.id` du compte parent direct.
- Validation à l'insertion d'un nouveau compte custom : `code` doit commencer par le `code` du parent (`parent.code === child.code.slice(0, parent.code.length)`), longueur child > longueur parent, parent doit être de type `POSTING` ou `TITLE` mais à transformer en `TITLE` si on lui ajoute des enfants (un compte mouvementé ne peut pas devenir un compte de titre, voir D5).

### D4. `account_type`: TITLE vs POSTING (déterminé par OHADA pour la référence, par présence d'enfants pour les comptes custom)

**Définition** :
- `TITLE` : compte de regroupement non mouvementable par les écritures (ex : `4 — Tiers`, `41 — Clients et comptes rattachés`, `411 — Clients`).
- `POSTING` : compte terminal mouvementable (ex : `4111 — Clients`, `4117 — Clients, retenues de garantie`).

**Pour la table de référence** : le type est figé dans le seed, conformément à l'AUDCIF.

**Pour la table d'organisation** : initialement copié depuis la référence. Quand l'utilisateur ajoute un sous-compte sous un compte précédemment terminal (ex : il crée `41110001 — Client SOTRA` sous `4111 — Clients`), le compte parent `4111` doit être promu `TITLE` automatiquement. Cette promotion est interdite si `4111` a déjà été mouvementé (sera enforced quand le Module 3 existera ; pour le Module 2, on tolère car aucune écriture n'existe encore).

### D5. Sens normal (D/C) dérivé de la classe OHADA

| Classe | Intitulé | Sens normal |
|--------|----------|-------------|
| 1 | Capitaux | Crédit |
| 2 | Immobilisations | Débit |
| 3 | Stocks | Débit |
| 4 | Tiers | Variable (sous-classes) |
| 5 | Trésorerie | Débit |
| 6 | Charges | Débit |
| 7 | Produits | Crédit |
| 8 | Autres charges & produits HAO | Variable |
| 9 | Comptes analytiques | Variable |

Pour les classes 4, 8, 9 le sens est fixé par compte dans le seed AUDCIF (ex : `401 Fournisseurs` = Crédit, `411 Clients` = Débit). Ce champ `normal_balance` est seedé et n'est pas calculé runtime.

### D6. Permissions RBAC ajoutées au catalogue Module 1

Deux permissions nouvelles :
- `chart_of_accounts.read` — assignée à : Admin, Expert-comptable, Chef de mission, Comptable, Auditeur, Client readonly.
- `chart_of_accounts.write` — assignée à : Admin, Expert-comptable, Chef de mission **uniquement**. Le rôle Comptable (saisie) en est volontairement exclu : laisser tout saisisseur créer des sous-comptes ad-hoc conduit à une prolifération anarchique du plan qui pollue les balances analytiques et casse la cohérence inter-dossiers du cabinet. La création de comptes custom relève d'une décision de gouvernance comptable, donc d'un rôle à autorité.

Ajoutées via une migration TypeORM 0011 qui insère les permissions + les `role_permissions` correspondantes (idempotent, vérifie via `INSERT … ON CONFLICT DO NOTHING`).

### D7. Endpoints REST

```
GET    /reference-chart-of-accounts?system=NORMAL|MINIMAL|ALLEGE
       — public (pas de TenantGuard), retourne le plan officiel.

GET    /organizations/:id/chart-of-accounts
       — read, arbre hiérarchique aplati avec depth et hasChildren.

GET    /organizations/:id/chart-of-accounts/:accountId
       — read, détail d'un compte.

POST   /organizations/:id/chart-of-accounts
       — write, crée un sous-compte custom sous un parent existant.

PATCH  /organizations/:id/chart-of-accounts/:accountId
       — write, modifie label/is_active (code immutable).

DELETE /organizations/:id/chart-of-accounts/:accountId
       — write, supprime si compte custom ET sans enfants actifs ET (Module 3 plus tard) jamais mouvementé.

POST   /organizations/:id/chart-of-accounts/import
       — write (admin only), force-clone du plan de référence dans le plan d'org. Idempotent : ne re-crée pas les comptes déjà présents.
```

Tous les endpoints `/organizations/:id/*` passent par le `TenantGuard` + `PermissionsGuard` du Module 1.

### D8. Modèle de données

```
organization_accounting_configs(
  organization_id  UUID PK FK→organizations(id) ON DELETE CASCADE,
  system           TEXT NOT NULL CHECK (system IN ('NORMAL','MINIMAL','ALLEGE')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- 1-1 avec organizations. Créé en transaction avec l'org.

reference_chart_accounts(
  id                  UUID PK DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL,
  label               TEXT NOT NULL,
  class               SMALLINT NOT NULL CHECK (class BETWEEN 1 AND 9),
  account_type        TEXT NOT NULL CHECK (account_type IN ('TITLE','POSTING')),
  normal_balance      TEXT NOT NULL CHECK (normal_balance IN ('D','C')),
  applicable_systems  TEXT[] NOT NULL,  -- ex: ['NORMAL','ALLEGE'] ou ['NORMAL']
  UNIQUE(code)
)
INDEX(class), INDEX USING GIN (applicable_systems)
-- Seedé par la migration 0011 depuis ohada-syscohada-audcif.ts. ~800 rows.

organization_chart_accounts(
  id                    UUID PK DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL FK→organizations(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,
  label                 TEXT NOT NULL,
  class                 SMALLINT NOT NULL,
  account_type          TEXT NOT NULL CHECK (account_type IN ('TITLE','POSTING')),
  normal_balance        TEXT NOT NULL CHECK (normal_balance IN ('D','C')),
  parent_id             UUID NULL FK→organization_chart_accounts(id) ON DELETE RESTRICT,
  reference_account_id  UUID NULL FK→reference_chart_accounts(id),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
)
INDEX(organization_id, class), INDEX(organization_id, code), INDEX(parent_id)
```

## Risks / Trade-offs

- **[Exhaustivité et exactitude du plan SYSCOHADA AUDCIF seedé]** → Mitigation : seed généré depuis le PDF officiel (Acte Uniforme révisé OHADA, annexe Plan comptable général), validé par lecture croisée du tableau 2 de l'AUDCIF. Une issue dédiée prévoit une revue manuelle par un expert-comptable avant la mise en prod réelle.
- **[Doublement du volume en base à chaque org]** → Accepté : ~800 lignes × N orgs reste négligeable face aux écritures futures (millions de lignes). Si un jour ça pose souci, on peut migrer vers une vue (`CREATE VIEW chart_of_accounts AS SELECT … FROM reference UNION ALL SELECT … FROM org`) sans casser l'API publique.
- **[Promotion d'un compte POSTING en TITLE quand on ajoute un sous-compte]** → Risque accepté : pour le Module 2 (sans écritures), on autorise. Le Module 3 ajoutera un check "compte jamais mouvementé" qui bloquera la promotion avec `CHART_ACCOUNT_HAS_POSTINGS` (409).
- **[Système comptable immutable]** → Risque accepté : changer de système après saisie est une opération comptable lourde qui justifie une change dédiée et un endpoint de migration explicite. Le wizard affichera un avertissement.
- **[Suppression accidentelle d'un compte de référence]** → Mitigation : pas d'endpoint d'écriture sur `reference_chart_accounts` côté API. Seule la migration de seed peut écrire dedans.
- **[Conflit de codes lors d'ajout custom]** → Mitigation : `UNIQUE(organization_id, code)` au niveau DB + validation applicative qui retourne `CHART_ACCOUNT_CODE_TAKEN` (409).
