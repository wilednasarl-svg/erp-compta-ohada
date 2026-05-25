# Roadmap de conformité SYSCOHADA RÉVISÉ

> Issue de l'analyse complète des 4 tomes du Guide d'application SYSCOHADA RÉVISÉ (2024) — 443 pages de doctrine. Synthèses détaillées (gitignored) dans `.local/synthese/tome-{1,2,3,4}-*.md`.

## Photographie de départ (mai 2026)

- **Score conformité DSF** : ~3,6 % (5 / 137 postes attendus)
- **Plan SYSCOHADA seedé** : ~170 / ~800 comptes (~21 %)
- **Modules métier manquants** : provisions, dépréciations, écarts FX clôture, régularisations périodiques, effets de commerce, crédit-bail, subventions d'investissement, contrats long terme
- **États financiers couverts** : balance + bilan en 4 buckets fourre-tout + CR sans cascade SIG
- **Tableau des flux de trésorerie (TFT)** : inexistant
- **Notes annexes (N1-N36)** : aucune

## Stratégie globale

5 vagues d'environ 2-4 semaines chacune. Chaque vague livre une cohérence métier complète, pas un saupoudrage.

```
V1 ─ Fondations            (sprint 1-2)   débloque V2-V4
V2 ─ Conformité DSF        (sprint 3-5)   livre 4 états + 36 notes
V3 ─ Modules d'inventaire  (sprint 6-8)   provisions, FX, cession, régul
V4 ─ Métiers spécifiques   (sprint 9-12)  amort, stock, TVA, effets, leasing
V5 ─ Qualité dépôt DSF     (sprint 13-15) PDF normalisé, validation, package
SKIP Consolidation                          hors cible cabinet PME (Tome 4)
```

---

## Vague 1 — Fondations (sprint 1-2)

**Objectif** : poser les briques sans lesquelles V2 ne tient pas.

| ID | Action | Module | Effort | Doctrine |
|---|---|---|---|---|
| W1.1 | Compléter le seed PCG SYSCOHADA AUDCIF (+300 comptes critiques) | `accounting-plan/seed/` | L | Tome 1 §1, Tome 2 multi-chapitres |
| W1.2 | Référentiels JSON `bilan-postes.ts` + `pl-postes.ts` (35+35 postes lettrés) | `reports/services/` | S | Tome 3 §5.2-5.3 |
| W1.3 | Étendre lettrage aux classes 43 (organismes sociaux) et 44 (État) | `journals/services/lettering.service.ts` | S | Tome 1 §3, §6 |
| W1.4 | Représentation des comptes opposants (`is_opposing` sur ReferenceAccount) | `accounting-plan/entities/` | M | Tome 1 §1 (29x/39x/49x/59x) |

## Vague 2 — Conformité DSF (sprint 3-5)

**Objectif** : production des 4 états financiers conformes à l'Acte uniforme article 8.

| ID | Action | Module | Effort |
|---|---|---|---|
| W2.1 | Refonte `ohada-classifier.ts` → 35 postes Bilan lettrés (AD-DZ) | `reports/services/` | M |
| W2.2 | Cascade SIG dans `getProfitLoss` (XA-XI : MC, VA, EBE, RE, RF, RAO, RHAO, R) | `reports/services/` | M |
| W2.3 | Service `CashFlowService` — TFT complet (FA-FQ + ZA-ZH) avec exclusions BFR | nouveau `reports/services/cash-flow.service.ts` | L |
| W2.4 | Moteur Notes annexes (36 notes typées + commentaires libres) | nouveau `reports/services/notes-annexes/` | XL |

## Vague 3 — Modules d'inventaire & clôture (sprint 6-8)

**Objectif** : couvrir les écritures de clôture obligatoires (article 54 AU).

| ID | Action | Module | Effort |
|---|---|---|---|
| W3.1 | Module `provisions/` (litige, garantie, démantèlement, retraite, change) | nouveau | L |
| W3.2 | Module `impairments/` (dépréciations immo + stocks avec test de valeur) | nouveau | M |
| W3.3 | Cession d'immobilisation complète (prorata amort + sortie bilan + produit) | `assets/services/` | M |
| W3.4 | Réévaluation FX clôture + contre-passation auto N+1 | nouveau `period-closing/` | L |
| W3.5 | Module `regularizations/` (CCA, PCA, CAP, PAR, contre-passation) | nouveau | L |

## Vague 4 — Métiers spécifiques (sprint 9-12)

**Objectif** : adresser les cas d'usage clients récurrents non couverts.

| ID | Action | Module | Effort |
|---|---|---|---|
| W4.1 | Centralisation TVA automatique post-déclaration (D 4441 / C 445+443) | `tva/services/` | M |
| W4.2 | Auto-génération écritures de mouvement stock + FIFO | `inventory/services/` | M |
| W4.3 | Moteur d'amortissement complet (linéaire + SOFTY + unités d'œuvre + dérogatoires) | `assets/services/` | L |
| W4.4 | Module `subsidies/` (subventions investissement, lien asset, reprise étalée) | nouveau | M |
| W4.5 | Module `leases/` (crédit-bail / location-acquisition + retraitement) | nouveau | L |
| W4.6 | Module `bills-of-exchange/` (effets de commerce : émission, escompte, impayé) | nouveau | L |

## Vague 5 — Qualité dépôt DSF (sprint 13-15)

**Objectif** : livrer un export DSF déposable au greffe / DGI sans retouche manuelle.

| ID | Action | Module | Effort |
|---|---|---|---|
| W5.1 | Fiches R1-R4 (page de garde + identification entité + dirigeants) | `reports/` + `organizations/` | M |
| W5.2 | Refonte exports PDF/XLSX selon contexture normalisée DGI | `reports/services/exports/` | M |
| W5.3 | Endpoint `/reports/dsf-package` → ZIP complet (4 états + R1-R4 + N1-N36) | `reports/controllers/` | S |
| W5.4 | Validation pré-dépôt (`DsfValidator.validate(orgId, exerciseId)`) | nouveau | M |
| W5.5 | Persistance pluri-exercices (snapshot SIG + bilan pour Note 31) | `reports/` | S |
| W5.6 | Contrats long terme (avancement / achèvement) | nouveau | L |
| W5.7 | Évènements postérieurs à la clôture | `reports/` + `workflows/` | S |

---

## Risques & dépendances

1. **Validation expert-comptable** indispensable pour W1.1 (seed PCG) et W2.* (mapping postes). Sans relecture OECCI, on diffuse des erreurs systémiques. Idéalement bloquer la merge sur ces vagues sans une review d'un expert.
2. **Effort total ≈ 16-20 semaines** d'un dev senior à temps plein. Sur une équipe à 1, prévoir 4-6 mois calendaires.
3. **V2 dépend de V1.1+V1.2**. V3 et V4 peuvent partir en parallèle de V2 (équipes séparées).
4. **Migration DB lourde** côté W1.1 et W3 (nouvelles tables provisions, impairments, regularizations).
5. **Tests** : chaque livraison doit reproduire un exemple chiffré de la doctrine (les "Applications" du tome 1 et 2 servent de cas de test directs).

## Tracking

Issues `bd` créées dans la wave 1 portent le préfixe `M40-` (Module 40 = SYSCOHADA Compliance). Voir `bd ready` ou `bd show <id>` pour le détail.

## Sources

- Guide d'application SYSCOHADA RÉVISÉ Tome 1 — Opérations courantes (86 p)
- Guide d'application SYSCOHADA RÉVISÉ Tome 2 — Opérations et problèmes spécifiques (244 p)
- Guide d'application SYSCOHADA RÉVISÉ Tome 3 — Présentation des états financiers (70 p)
- Guide d'application SYSCOHADA RÉVISÉ Tome 4 — Comptes consolidés & combinés (43 p) — SKIP V1

PDFs sources hébergés dans `.local/sources/` (gitignored).
Synthèses détaillées par tome dans `.local/synthese/` (gitignored, ~1500 lignes).
