# Mapping doctrinal SYSCOHADA — modules à relier au Guide

> Document de référence pour étendre `DOMAIN_REFERENCES` (service) et
> `control-catalog.ts` aux modules métier pas encore « doctrine-aware ».
>
> **Chaque rattachement ci-dessous est vérifié dans le texte réel des PDF
> embarqués** (`apps/backend/src/modules/syscohada-knowledge/sources/`, Tomes 1-3) :
> tome + chapitre/section + n° de ligne de l'extrait dans le `.txt` extrait.
> Les n° de ligne réfèrent aux fichiers `*.pdf.1-end.txt` (≈ ancrage, pas page PDF).
>
> Règle de citation : on n'affirme un article AUDCIF que lorsqu'il est certain
> (art. 8 composition des états, art. 17 partie double/inventaire, art. 35
> dépréciations/provisions à l'inventaire). Sinon → tome + chapitre (prouvé) +
> principe comptable nommé. L'extrait verbatim (rapatrié par `evidenceQuery`)
> reste la preuve.

## Légende confiance
- **Forte** : chapitre dédié dans le Guide, ancrage net.
- **Moyenne** : sujet présent mais réparti / nommé différemment.
- **Faible** : pas de chapitre dédié ; rattachement indirect — à valider avant de citer.

---

## Priorité 1 — chapitres dédiés (confiance Forte)

### leases (Contrat de location / location-acquisition)
- **Domaine** : `leases` · **Tome 2, Chapitre 8 — « Contrat de location »** (ligne 731).
- **Ancre** (L718) : « Il s'agit d'un contrat de location acquisition car le preneur est raisonnablement certain… » ; comptabilisation d'une *Dette de location acquisition* (L726-728).
- **Topic proposé** : « Contrats de location : location-acquisition vs location simple, retraitement à l'actif et dette ».
- **Keywords** : `location`, `credit-bail`, `location acquisition`, `preneur`, `bailleur`, `redevance`.
- **Contrôle proposé** : *Retraitement location-acquisition* — une location transférant les risques/avantages est inscrite à l'actif avec sa dette (approche substance). Sévérité `warning`. Base : Guide Tome 2 Chap. 8.
- **evidenceQuery** : `contrat location acquisition preneur dette redevance immobilisation`.

### impairments (Dépréciations des immobilisations)
- **Domaine** : `impairments` · **Tome 2, Chapitre 12 — « Dépréciations des immobilisations »** (ligne 1273). Aussi dépréciation des créances clients (L1006-1007, cpte 4912 / 6594).
- **Topic proposé** : « Dépréciations : test de valeur à l'inventaire, valeur actuelle < VNC, comptes 29x/39x/49x ».
- **Keywords** : `depreciation`, `valeur actuelle`, `valeur nette comptable`, `perte de valeur`, `creances douteuses`.
- **Contrôle proposé** : *Dépréciation à l'inventaire* — toute perte de valeur durable est constatée même sans bénéfice. Sévérité `warning`. Base : **AUDCIF art. 35** + Guide Tome 2 Chap. 12.
- **evidenceQuery** : `depreciation immobilisation valeur actuelle nette comptable perte inventaire`.

### subsidies (Subventions et aides publiques)
- **Domaine** : `subsidies` · **Tome 2, Chapitre 17 — « Subventions et aides publiques »** (ligne 2327). Ancre L2309 : « 4494 État, subventions d'investissement à recevoir ».
- **Topic proposé** : « Subventions d'investissement (cpte 14) : reprise au résultat au rythme des amortissements du bien financé ».
- **Keywords** : `subvention`, `subvention investissement`, `aide publique`, `reprise`, `quote-part`.
- **Contrôle proposé** : *Reprise étalée de la subvention* — la subvention d'investissement (141/142) est rapportée au résultat (865) au même rythme que l'amortissement du bien. Sévérité `warning`. Base : Guide Tome 2 Chap. 17.
- **evidenceQuery** : `subvention investissement reprise quote part amortissement bien finance`.

### provisions (Provisions, passifs éventuels)
- **Domaine** : `provisions` · **Tome 2, Chapitre 18 — « Provisions, passifs éventuels »** (ligne 2660). Dotations provisions pour risques (L638, cpte 6971).
- **Topic proposé** : « Provisions pour risques et charges (cpte 19) : obligation actuelle, sortie de ressources probable, estimation fiable ».
- **Keywords** : `provision`, `risque`, `charge`, `passif eventuel`, `obligation`, `litige`.
- **Contrôle proposé** : *Constatation d'une provision* — une obligation actuelle dont l'extinction est probable et estimable donne lieu à provision à la clôture. Sévérité `warning`. Base : **AUDCIF art. 35** + Guide Tome 2 Chap. 18.
- **evidenceQuery** : `provision risque charge obligation probable estimation litige clôture`.

### actuarial-commitments (Engagements de retraite)
- **Domaine** : `actuarial-commitments` · **Tome 2, Chapitre 21 — « Engagements de retraite et autres avantages »** (ligne 3234). Ancre L3334 : « l'obligation relative aux indemnités de départ à la retraite s'élève à… ».
- **Topic proposé** : « Engagements de retraite et avantages au personnel : évaluation actuarielle, provision (cpte 19) ou information en Note annexe ».
- **Keywords** : `retraite`, `engagement`, `indemnite depart`, `avantages personnel`, `actuariel`.
- **Contrôle proposé** : *Engagements de retraite couverts* — les indemnités de départ sont provisionnées ou, à défaut, mentionnées en Note annexe. Sévérité `info`. Base : Guide Tome 2 Chap. 21.
- **evidenceQuery** : `engagements retraite indemnite depart avantages personnel actuariel provision`.

---

## Priorité 2 — sujets présents, rattachement à confirmer (confiance Moyenne)

### bills-of-exchange (Effets de commerce)
- **Domaine** : `bills-of-exchange` · **Tome 1** — effets de commerce / traites (L1225 : « Le SYSCOHADA limite la notion d'effet de commerce aux traites… ») ; escompte (L474).
- **Topic** : « Effets de commerce : émission, escompte (cpte 565), effets à l'encaissement, impayés ».
- **Keywords** : `effet de commerce`, `traite`, `escompte`, `encaissement`, `impaye`.
- **Contrôle proposé** : *Traitement de l'escompte d'effet* — l'escompte est enregistré au règlement, agios en charges financières. Sévérité `info`. Base : Guide Tome 1 (effets de commerce).
- **evidenceQuery** : `effet commerce traite escompte agios encaissement impaye`.

### multi-currency (Opérations en monnaie étrangère)
- **Domaine** : `multi-currency` · **Tome 1 + Tome 2** — opérations en monnaie étrangère (T1 L2645), écart de conversion + contrepassation N+1 (T2 L3562).
- **Topic** : « Opérations en devises : conversion au cours, écarts de conversion actif/passif (478/479), provision pour perte de change ».
- **Keywords** : `monnaie etrangere`, `devise`, `cours`, `ecart de conversion`, `perte de change`.
- **Contrôle proposé** : *Écart de conversion à la clôture* — les dettes/créances en devises sont réévaluées au cours de clôture ; perte latente → provision, écart contrepassé en N+1. Sévérité `warning`. Base : Guide Tome 1/2.
- **evidenceQuery** : `monnaie etrangere conversion cours cloture ecart perte change contrepassation`.

### pledged-assets (Sûretés / nantissements)
- **Domaine** : `pledged-assets` · **Tome 2, Chapitre 30 — « Engagements financiers et passifs éventuels »** (ligne 5280).
- **Topic** : « Sûretés données (nantissements, hypothèques, gages) : engagements hors bilan à mentionner en Note annexe ».
- **Keywords** : `nantissement`, `gage`, `hypotheque`, `surete`, `engagement hors bilan`.
- **Contrôle proposé** : *Sûretés mentionnées hors bilan* — les actifs nantis/gagés font l'objet d'une information en engagements hors bilan / Note annexe. Sévérité `info`. Base : Guide Tome 2 Chap. 30.
- **evidenceQuery** : `nantissement gage surete engagement hors bilan garantie`.

### regularizations (Régularisations / indépendance des exercices)
- **Domaine** : `regularizations` · **Tome 3** — Charges constatées d'avance (cpte 476, L589/L774), et charges à payer / produits à recevoir.
- **Topic** : « Régularisations de fin d'exercice : CCA (476), PCA (477), charges à payer, produits à recevoir — spécialisation des exercices ».
- **Keywords** : `regularisation`, `charges constatees avance`, `produits constates avance`, `charges a payer`, `independance exercices`.
- **Contrôle proposé** : *Indépendance des exercices* — charges/produits sont rattachés à l'exercice qu'ils concernent via CCA/PCA, charges à payer, produits à recevoir. Sévérité `warning`. Base : principe de spécialisation des exercices + Guide Tome 3 (postes bilan).
- **evidenceQuery** : `charges constatees avance produits charges a payer regularisation independance exercice`.

### cash-flow (Tableau des flux de trésorerie)
- **Domaine** : `cash-flow` · **Tome 3, Section 4 — « Tableau des flux de trésorerie »** (ligne 211 ; postes FA-FQ / ZA-ZH, L57).
- **Topic** : « TFT : flux opérationnels, d'investissement, de financement ; variation de trésorerie (postes FA-FQ, ZA-ZH) ».
- **Keywords** : `flux tresorerie`, `tft`, `investissement`, `financement`, `variation tresorerie`.
- **Contrôle proposé** : *Cohérence variation de trésorerie* — la variation nette du TFT (ZH) égale la variation des disponibilités au bilan. Sévérité `blocking`. Base : **AUDCIF art. 8** + Guide Tome 3 Section 4.
- **evidenceQuery** : `tableau flux tresorerie operationnel investissement financement variation`.

---

## À NE PAS forcer (confiance Faible — valider avant tout rattachement)

- **transformations** : le module applicatif désigne des *retraitements/recalculs* internes, pas une opération doctrinale. Le seul chapitre proche est **Tome 2 Chap. 38 « Fusions et opérations assimilées »** (L6661), qui relève des restructurations (proche de la consolidation, hors cible PME). → Ne pas rattacher sauf si le module traite réellement de fusions/apports.
  - **RÉSOLU (bug `jb0y`, 2026-05-29)** : la doctrine Fusions (Tome 2 Ch.38) avait été câblée par erreur sous le module Transformation Engine. Domaine renommé `transformations` → **`business-combinations`** et contrôleur guidance déplacé hors du module `transformations/` vers `syscohada-knowledge/controllers/` (route `business-combinations/syscohada-guidance`). Le Transformation Engine ne sert plus de doctrine fusions.
- **bank-reconciliation** : le rapprochement bancaire est une procédure de contrôle interne, pas un chapitre doctrinal dédié. Rattachement faible (comptes financiers, Tome 1). → Garder éventuellement un seul contrôle `info` « rapprochement périodique des comptes 52x ».
- **accounting-score / audit / dashboards** : transversaux/analytiques, hors doctrine directe.

---

## Synthèse pour le code (à intégrer dans `DOMAIN_REFERENCES` / `control-catalog.ts`)

| Module | slug domaine | Tome | Ancre vérifiée | Confiance |
|---|---|---|---|---|
| leases | `leases` | 2 | Chap. 8 (L731) | Forte |
| impairments | `impairments` | 2 | Chap. 12 (L1273) | Forte |
| subsidies | `subsidies` | 2 | Chap. 17 (L2327) | Forte |
| provisions | `provisions` | 2 | Chap. 18 (L2660) | Forte |
| actuarial-commitments | `actuarial-commitments` | 2 | Chap. 21 (L3234) | Forte |
| bills-of-exchange | `bills-of-exchange` | 1 | effets/traites (L1225) | Moyenne |
| multi-currency | `multi-currency` | 1/2 | écart conversion (T2 L3562) | Moyenne |
| pledged-assets | `pledged-assets` | 2 | Chap. 30 (L5280) | Moyenne |
| regularizations | `regularizations` | 3 | CCA cpte 476 (L589) | Moyenne |
| cash-flow | `cash-flow` | 3 | Section 4 (L211) | Forte |
| business-combinations | `business-combinations` | 2 | Chap. 38 fusions (L6661) | Forte |
| bank-reconciliation | — | 1 | comptes financiers | Faible |

> Vérifié contre les sources embarquées (Tomes 1-3) le 2026-05-29. Voir
> `docs/syscohada-knowledge.md` pour le socle et `project_syscohada_sources` (mémoire) pour le sourcing.
