# Plan comptable OHADA — Module 2

## Norme

Conformité **SYSCOHADA AUDCIF révisé** (Acte Uniforme OHADA portant
organisation et harmonisation des comptabilités des entreprises,
applicable depuis le 1ᵉʳ janvier 2018 dans les 17 États OHADA, dont la
Côte d'Ivoire).

Le plan comptable est la colonne vertébrale dont dépend chaque module
métier ultérieur : aucune écriture, aucun import bancaire, aucun
rapport ne peut être implémenté sans un référentiel de comptes fiable
et adossé au plan officiel.

## Trois systèmes comptables

| Système | Cible | Plan |
|---|---|---|
| `NORMAL` | PME et grandes entreprises | Plan complet (~800 comptes), comptabilité d'engagement |
| `MINIMAL` | Très petites entités (cf. art. 13 AUDCIF) | Plan réduit (~400 comptes), comptabilité d'encaissement |
| `ALLEGE` | Entités intermédiaires | Plan intermédiaire (~600 comptes), états financiers simplifiés |

Le système est **choisi à la création de l'organisation** (`POST /organizations`
body field `system`) et **immuable** ensuite. Changer de système après
des saisies impose une migration comptable formelle (retraitements TVA,
rapprochement encaissements) qui sortira d'une change dédiée — pas un
toggle.

## Deux tables, un référentiel et un plan par organisation

- **`reference_chart_accounts`** (migration 0011) — catalogue global
  immuable, partagé. Aucun endpoint API n'écrit ; le seul chemin
  d'évolution est une migration officielle. Lecture publique via
  `GET /reference-chart-of-accounts?system=NORMAL|MINIMAL|ALLEGE`.
- **`organization_chart_accounts`** (migration 0013) — clone
  personnalisable par organisation. Cloné à la création (en
  transaction avec l'insertion de l'org + de la config comptable).
  L'org peut ajouter des sous-comptes, désactiver des comptes inutiles
  et modifier les libellés — sans altérer la structure des classes
  normées.

## Structure d'un compte

Chaque compte du plan de référence porte :

```ts
{
  code: string,              // 1–10 digits ; 1-digit = racine de classe
  label: string,
  class: 1..9,               // premier chiffre du code
  account_type: 'TITLE' | 'POSTING',
  normal_balance: 'D' | 'C',
  applicable_systems: ('NORMAL' | 'MINIMAL' | 'ALLEGE')[]
}
```

### TITLE vs POSTING

- **`TITLE`** — compte de regroupement (nœud non mouvementable). Aucune
  écriture comptable ne pourra cibler un compte TITLE (invariant qui
  sera enforced par Module 3). Exemples : `4 — Tiers`,
  `41 — Clients et comptes rattachés`, `411 — Clients`.
- **`POSTING`** — compte terminal (feuille). Seul autorisé comme cible
  d'écriture. Exemples : `4111`, `40110001`.

### Sens normal (Débit / Crédit)

Dérivé de la classe pour les classes 1, 2, 3, 5, 6, 7 ; fixé compte par
compte pour les classes 4, 8, 9 où la convention varie (ex : `401
Fournisseurs` = Crédit, `411 Clients` = Débit).

| Classe | Intitulé | Sens normal |
|--------|----------|-------------|
| 1 | Capitaux | Crédit |
| 2 | Immobilisations | Débit |
| 3 | Stocks | Débit |
| 4 | Tiers | **Variable** par sous-compte |
| 5 | Trésorerie | Débit |
| 6 | Charges | Débit |
| 7 | Produits | Crédit |
| 8 | Autres charges & produits HAO | **Variable** |
| 9 | Comptes analytiques | **Variable** |

## Hiérarchie par préfixe

Un sous-compte `4111` est enfant de `411`, lui-même enfant de `41`,
lui-même enfant de `4`. La règle est enforcée applicativement par
`ChartOfAccountsService.createCustomAccount` :

- le code du child DOIT commencer par le code du parent ;
- le code du child DOIT être strictement plus long que le code du parent ;
- le code du child DOIT matcher `/^\d{2,10}$/` ;
- le code DOIT être unique au sein de l'organisation.

La table `organization_chart_accounts` matérialise en plus un
`parent_id` (FK self) pour les lectures arborescentes rapides.

## Invariants

| Invariant | Code d'erreur | HTTP | Enforced par |
|---|---|---|---|
| Code immutable après création | `CHART_ACCOUNT_IMMUTABLE_CODE` | 422 | `ChartOfAccountsService.updateAccount` |
| Préfixe parent obligatoire | `CHART_ACCOUNT_INVALID_PARENT` | 422 | `createCustomAccount` |
| Code 2–10 digits | `CHART_ACCOUNT_INVALID_CODE` | 422 | `createCustomAccount` + DTO regex |
| Code unique dans l'org | `CHART_ACCOUNT_CODE_TAKEN` | 409 | `createCustomAccount` + `UNIQUE(organization_id, code)` |
| Compte de référence indélétable | `CHART_ACCOUNT_NOT_DELETABLE` | 409 | `deleteAccount` (check `reference_account_id IS NULL`) |
| Compte avec enfants actifs indélétable | `CHART_ACCOUNT_NOT_DELETABLE` | 409 | `deleteAccount` (check `countChildren > 0`) |
| Promotion auto POSTING → TITLE | implicit | — | `createCustomAccount` quand le parent gagne son 1er enfant |

## Endpoints

| Méthode | URL | Permission | Description |
|---|---|---|---|
| `GET` | `/reference-chart-of-accounts?system=…` | public (`@Public()`) | Catalogue de référence officiel filtré par système |
| `GET` | `/organizations/:id/chart-of-accounts` | `chart_of_accounts.read` | Plan complet de l'org (arbre aplati ordonné par code) |
| `GET` | `/organizations/:id/chart-of-accounts/:accountId` | `chart_of_accounts.read` | Détail d'un compte |
| `POST` | `/organizations/:id/chart-of-accounts` | `chart_of_accounts.write` | Ajoute un sous-compte custom |
| `PATCH` | `/organizations/:id/chart-of-accounts/:accountId` | `chart_of_accounts.write` | Met à jour label / isActive (code immutable) |
| `DELETE` | `/organizations/:id/chart-of-accounts/:accountId` | `chart_of_accounts.write` | Supprime un compte custom + feuille |
| `POST` | `/organizations/:id/chart-of-accounts/import` | `chart_of_accounts.write` | Re-clone idempotent depuis le référentiel (recovery) |

## Permissions RBAC

| Rôle | `chart_of_accounts.read` | `chart_of_accounts.write` |
|------|:---:|:---:|
| `admin` | ✓ | ✓ |
| `expert_comptable` | ✓ | ✓ |
| `chef_mission` | ✓ | ✓ |
| `comptable` | ✓ | **✗** |
| `auditeur` | ✓ | ✗ |
| `client_readonly` | ✓ | ✗ |

> Le rôle `comptable` (saisie) est exclu de `chart_of_accounts.write` :
> discipline anti-prolifération de sous-comptes ad-hoc qui pollueraient
> les balances analytiques. Cf. `openspec/changes/module-2-plan-comptable/design.md`
> (D6) pour la justification métier.

## Audit

Événements écrits dans `auth_events` à chaque mutation du plan :

- `chart_of_accounts.imported` — à la création de l'org (post-clone).
  Metadata : `{ system, accountCount }`.
- `chart_of_accounts.account_created` — création d'un sous-compte
  custom. Metadata : `{ accountId, code, label, parentCode }`.
- `chart_of_accounts.account_updated` — modification de label OU
  promotion auto du parent POSTING → TITLE OU suppression
  (`action: 'deleted'`).
- `chart_of_accounts.account_deactivated` — passage `is_active = false`.

## Exemples

### Création d'organisation avec choix du système

```http
POST /organizations
Content-Type: application/json
Authorization: Bearer <user-jwt>

{
  "name": "Cabinet Konan & Associés",
  "type": "firm",
  "system": "NORMAL"
}
```

→ `201 Created`. En une seule transaction : org + membership admin du
créateur + config comptable + clone du plan SYSCOHADA Normal (~800 comptes).
Si l'une des 4 étapes échoue, rollback total.

### Ajout d'un sous-compte client custom

```http
POST /organizations/<orgId>/chart-of-accounts
Content-Type: application/json
Authorization: Bearer <scoped-jwt>

{
  "parentCode": "411",
  "code": "41100001",
  "label": "Client SOTRA"
}
```

→ `201 Created` avec le compte projeté. Si `411` était `POSTING`, il
est automatiquement promu `TITLE` dans la même transaction (un compte
mouvementé ne peut pas être à la fois cible d'écriture et nœud
parent).

### Lecture publique du référentiel

```http
GET /reference-chart-of-accounts?system=MINIMAL
```

→ `200 OK` avec tous les comptes applicables au Système Minimal de
Trésorerie, triés par code croissant. Aucun token requis.

## Références

- Acte Uniforme OHADA portant organisation et harmonisation des
  comptabilités des entreprises (révisé 2017).
- AUDCIF, annexe : Plan comptable général SYSCOHADA.
- Specs détaillées :
  - `openspec/changes/module-2-plan-comptable/proposal.md`
  - `openspec/changes/module-2-plan-comptable/design.md`
  - `openspec/changes/module-2-plan-comptable/specs/accounting-plan/spec.md`
