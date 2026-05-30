# Module Budget · Fiscal · Social (Côte d'Ivoire)

Documentation fonctionnelle et technique : structure des données, **règles de
calcul** et **formules** des modules **Budget / contrôle budgétaire**,
**Fiscal** et **Social (charges sur salaires)**.

> ⚠️ **Avertissement** : les taux et barèmes seedés par défaut sont des
> **ordres de grandeur** à **valider** contre l'Annexe fiscale (DGI) et le
> barème CNPS en vigueur. Tout est **paramétrable** et **versionné par date
> d'effet** — voir [§2.1](#21-paramètres-fiscaux-fiscal_parameters).

---

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Modèle de données](#2-modèle-de-données)
3. [Module Budget — contrôle budgétaire](#3-module-budget--contrôle-budgétaire)
4. [Module Fiscal — déclarations](#4-module-fiscal--déclarations)
5. [Module Social — charges sur salaires](#5-module-social--charges-sur-salaires)
6. [Échéancier & trésorerie](#6-échéancier--trésorerie)
7. [Workflow & API](#7-workflow--api)

---

## 1. Vue d'ensemble

Les **déclarations fiscales** et **sociales** partagent le même moteur mais
sont **séparées** dans l'interface (deux échéanciers distincts), distinguées
par le champ `declarationKind` du paramètre :

| Nature (`declarationKind`) | Exemples | Destinataire |
|---|---|---|
| `fiscal` | TVA, IS, IMF, patente, retenues BIC/BNC | DGI (impôts) |
| `social` | CNPS (retraite, PF, AT), FDFP, ITS | CNPS / DGI (salaires) |

Principe directeur : **aucun taux n'est codé en dur**. Chaque impôt/contribution
est un **paramètre versionné par date d'effet**. Une déclaration = base × taux
(ou barème) → montant dû + date limite, suivie par statut de dépôt.

---

## 2. Modèle de données

### 2.1 Paramètres fiscaux (`fiscal_parameters`)

Taux versionnés. Champs clés :

| Champ | Rôle |
|---|---|
| `tax_code` | Identifiant (TVA, IS, CNPS_PF…) |
| `declaration_kind` | `fiscal` \| `social` |
| `rate` | Taux en % (NUMERIC 8,4) ; `0` si barème progressif |
| `base_kind` | Comment dériver la base (voir [§4.1](#41-dérivation-de-la-base-base_kind)) |
| `periodicity` | `monthly` \| `quarterly` \| `annual` |
| `ceiling` | Plafond de base (CNPS) ; NULL sinon |
| `due_day` | Jour limite de dépôt (1-31) |
| `charge_account` / `liability_account` | Comptes SYSCOHADA (64x / 44x-43x) |
| `effective_from` / `effective_to` | Fenêtre de validité (versionnement) |

### 2.2 Déclarations (`fiscal_declarations`)

Une déclaration générée pour une période : `base_amount`, `rate` (figé),
`amount_due`, `due_date`, `status`, comptes, références de dépôt.
Clé naturelle : `(org, tax_code, period_year, period_month)`.

### 2.3 Barèmes progressifs (`fiscal_tax_brackets`)

Tranches versionnées pour l'ITS : `[from_amount, to_amount) × rate`, dernière
tranche ouverte (`to_amount = NULL`). Voir [§5.2](#52-its--barème-progressif).

### 2.4 Paie sociale (`social_payroll_lines`)

Salaire **brut par salarié et par mois** — base du calcul **par tête** des
charges sociales (voir [§5.1](#51-pourquoi-le-calcul-par-tête)).

---

## 3. Module Budget — contrôle budgétaire

### 3.1 Ligne budgétaire

Maille atomique : `Exercice × Période × Compte SYSCOHADA × Axe analytique ×
Type (OPEX/CAPEX/TRESO/RH) × Scénario (BI/BR/REAL)`.
`BI` = budget initial, `BR` = budget révisé, `REAL` = réalisé.

`amount_base` = `amount × exchange_rate` (consolidation en XOF).

### 3.2 Écarts (réalisé vs budget) — formules

Par dimension (compte, centre de coût, projet…) :

```
budget   = Σ amount_base  (scénario = BI ou BR)
réalisé  = Σ amount_base  (scénario = REAL)
écart            = réalisé − budget
écart %          = (réalisé − budget) / |budget| × 100      (null si budget = 0)
taux réalisation = réalisé / budget × 100
```

**Sens SYSCOHADA** (favorable/défavorable) :

```
si compte de PRODUIT (classe 7) :  écart favorable ⟺ réalisé ≥ budget
sinon (charge / perspective coût) : écart favorable ⟺ réalisé ≤ budget
```

Exemple — loyer (charge 6221) budget 1 500 000, réalisé 1 620 000 :
écart = +120 000 ; écart % = +8 % ; **défavorable** (dépassement de charge).

---

## 4. Module Fiscal — déclarations

### 4.1 Dérivation de la base (`base_kind`)

La base est **dérivée automatiquement** de la comptabilité validée (écritures
`validated`) sur la période, ou saisie. Conventions de signe SYSCOHADA :

| `base_kind` | Formule | Comptes |
|---|---|---|
| `turnover` (CA) | `Σ crédit − Σ débit` | classe 7 |
| `accounting_result` | `produits − charges` = `Σ(crédit−débit classe 7) − Σ(débit−crédit classe 6)` | 7 et 6 |
| `salary_gross` | `Σ débit − Σ crédit` | classe 66 |
| `salary_capped` | `Σ min(brut_i, plafond)` **par tête** | paie |
| `vat_net` | `TVA collectée − TVA déductible` = `(Σ créd−déb 443) − (Σ déb−créd 445)` | 443 / 445 |
| `custom` | Saisie manuelle (ex. patente) | — |

### 4.2 Montant dû — formule (taux plat)

```
base_plafonnée = ceiling ? min(base, ceiling) : base
montant_dû     = base_plafonnée × rate / 100        (arrondi au centime, demi-sup)
```

### 4.3 Catalogue fiscal CI (valeurs par défaut — à valider)

| Code | Libellé | Base | Taux | Périodicité | Échéance |
|---|---|---|---|---|---|
| `TVA` | TVA (taux normal) | `vat_net` | 18 % | mensuelle | le 15 du mois suivant |
| `IS` | Impôt sur les sociétés | `accounting_result` | 25 % | annuelle | avril N+1 |
| `IMF` | Impôt minimum forfaitaire | `turnover` | 0,5 % du CA | annuelle | avril N+1 |
| `PATENTE` | Contribution des patentes | `custom` | barème | annuelle | — |

Règle IS/IMF : l'impôt dû = **max(IS, IMF)**.
TVA : un crédit (déductible > collectée) est reporté sur la période suivante.

### 4.4 Date limite — formule

```
mensuel    : due_day du MOIS SUIVANT la période  (déc → janvier N+1)
trimestriel: due_day du mois suivant la fin de trimestre
annuel     : due_day d'AVRIL de l'exercice suivant (N+1)
```
Le jour est borné au dernier jour du mois cible (ex. due_day 31 en février → 28/29).

---

## 5. Module Social — charges sur salaires

### 5.1 Pourquoi le calcul PAR TÊTE

Le **plafond CNPS** et le **barème ITS** s'appliquent à **chaque salarié
individuellement**. Calculer sur la masse salariale agrégée est **faux** :

- **Plafond** : `Σ min(brut_i, plafond)` ≠ `min(Σ brut_i, plafond)`.
- **Progressif (ITS)** : non additif — `Σ ITS(brut_i)` ≠ `ITS(Σ brut_i)`.

> **Preuve** (barème 16 % au-delà de 75 000) — 2 salariés à 100 000 et 300 000 :
> - **par tête** : `16%×25 000 + 16%×225 000 = 4 000 + 36 000 = 40 000` ✓
> - **agrégat** (400 000) : `16%×325 000 = 52 000` ✗

D'où la table `social_payroll_lines` (brut par salarié) et un calcul par tête.

### 5.2 ITS — barème progressif

```
ITS(brut) = Σ sur les tranches de  (min(brut, borne_sup) − borne_inf) × taux
            pour les tranches où brut > borne_inf

ITS_total = Σ_salariés ITS(brut_i)        (par tête, puis sommé)
```

Barème CI mensuel par défaut (**ILLUSTRATIF — à valider DGI**) :

| Tranche (FCFA/mois) | Taux marginal |
|---|---|
| 0 – 75 000 | 0 % |
| 75 000 – 240 000 | 16 % |
| 240 000 – 800 000 | 21 % |
| 800 000 – 2 400 000 | 24 % |
| 2 400 000 – 8 000 000 | 28 % |
| > 8 000 000 | 32 % |

### 5.3 CNPS & FDFP — taux plafonné par tête

```
base   = Σ_salariés min(brut_i, plafond)      (plafonnement PAR TÊTE)
montant = base × taux / 100                    (linéaire ⇒ exact)
```

Catalogue social CI par défaut (**à valider CNPS/DGI**) :

| Code | Contribution | Base | Taux | Plafond | Part |
|---|---|---|---|---|---|
| `CNPS_RETRAITE_EMP` | Retraite | salaire plafonné | 7,7 % | 45× SMIG | employeur |
| `CNPS_RETRAITE_SAL` | Retraite | salaire plafonné | 6,3 % | 45× SMIG | salariale |
| `CNPS_PF` | Prestations familiales | salaire plafonné | 5,75 % | ~70 000 | employeur |
| `CNPS_AT` | Accident du travail | salaire plafonné | 2 %–5 % | ~70 000 | employeur |
| `FDFP_TA` | Taxe d'apprentissage | masse brute | 0,4 % | — | employeur |
| `FDFP_FPC` | Formation continue | masse brute | 0,6 % | — | employeur |
| `ITS` | Impôt sur salaires | par tête | barème | — | salariale |

Retraite totale = 14 % (7,7 employeur + 6,3 salarié).

### 5.4 Génération des déclarations sociales

Pour chaque contribution sociale de la période, le service calcule le montant
**par tête** puis le génère via `amountOverride` (court-circuite le calcul
agrégé). Endpoint : `POST …/fiscal/social-payroll/generate-declarations`.

---

## 6. Échéancier & trésorerie

Chaque déclaration s'inscrit à sa **date limite** dans l'échéancier (séparé
fiscal / social). Le **déversement en trésorerie** crée une ligne budgétaire
`TRESO` scénario `BR` (prévisionnel), montant **négatif** (décaissement),
imputée au compte de dette, au mois de l'échéance :

```
ligne TRESO = − montant_dû  @ (année, mois de due_date)  compte = liability_account
```

C'est la **boucle vertueuse** fiscal/social → trésorerie : les sorties fiscales
(cause n°1 des tensions de cash) apparaissent nativement dans le prévisionnel.

---

## 7. Workflow & API

### 7.1 Statuts de déclaration

```
à_déposer → déposé → payé          (annulable à chaque étape)
```
Une déclaration `déposé`/`payé` n'est plus recalculable (figée).

### 7.2 Endpoints principaux

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `…/fiscal/parameters?declarationKind=fiscal\|social` | Paramètres par nature |
| `POST` | `…/fiscal/parameters/seed-defaults` | Seed catalogue CI |
| `GET` | `…/fiscal/declarations` | Échéancier (séparé par nature côté UI) |
| `POST` | `…/fiscal/declarations/generate-auto` | Génère (base dérivée compta) |
| `POST` | `…/fiscal/declarations/:id/spill-to-treasury` | Déverse en trésorerie |
| `PUT` | `…/fiscal/brackets` + `POST …/seed-its-defaults` | Barème ITS |
| `POST` | `…/fiscal/social-payroll/lines` | Saisie paie (brut/salarié) |
| `GET` | `…/fiscal/social-payroll/summary` | Charges sociales par tête |
| `POST` | `…/fiscal/social-payroll/generate-declarations` | Génère les sociales |
| `GET` | `…/budget/variance?fiscalYear&groupBy` | Écarts réalisé vs budget |
| `GET/POST` | `…/budget/{template.xlsx,import,export.xlsx}` | Import/export budget |

### 7.3 Mise en service (par organisation)

1. `POST …/fiscal/parameters/seed-defaults` (taux CI)
2. `POST …/fiscal/brackets/seed-its-defaults` (barème ITS)
3. Saisir la paie (`…/social-payroll/lines`) puis générer les sociales
4. Générer les fiscales (`…/declarations/generate-auto`)

> Précision monétaire : tous les montants sont des `string` NUMERIC manipulés
> en `bigint` (centimes) — zéro erreur IEEE-754.
