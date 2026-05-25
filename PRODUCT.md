# PRODUCT — ERP Compta OHADA

> Plateforme SaaS de retraitement comptable OHADA pour cabinets d'expertise comptable et PME en Côte d'Ivoire et zone UEMOA.

## Register

**product** — l'outil sert le travail des comptables. Le design soutient la précision, la confiance et l'endurance visuelle sur des journées de 8 heures, sans devenir lui-même le sujet.

## Users

**Utilisateur primaire — Expert-comptable ivoirien (cabinet 3-15 personnes)**
- 30-55 ans, formation supérieure en comptabilité OHADA, certifié OECCI
- Passe 6-8h/jour dans l'outil : saisie d'écritures, lettrage, déclarations TVA, états financiers
- Connaît Sage Saari, Ciel Compta, parfois SAP Business One. Vient probablement de l'un des trois
- Cabinet à Abidjan (Plateau, Cocody, Marcory) ou en région (Bouaké, San-Pédro)
- Travaille avec lumière naturelle filtrée + lampe de bureau, écran 24-27"
- Fatigue oculaire en fin de journée, sensible aux interfaces criardes
- Valeurs : précision, traçabilité, conformité, sérénité

**Utilisateur secondaire — Collaborateur comptable junior (1-3 ans d'expérience)**
- 22-30 ans, BTS ou licence pro comptabilité
- Saisie de masse, rapprochements bancaires, premières déclarations
- Plus mobile (laptop, parfois tablette en clientèle)
- Apprend le métier en utilisant l'outil — l'interface doit enseigner sans condescendre

**Utilisateur tertiaire — Dirigeant PME consultant ses comptes**
- 35-60 ans, lit ses états financiers mensuels, valide budgets
- Usage occasionnel, doit comprendre sans formation
- Pas comptable de formation — chiffres lisibles, vocabulaire métier minimal

## Product Purpose

Remplacer Sage Saari sur le marché ivoirien en offrant :

1. **Conformité OHADA native** — plan SYSCOHADA, journaux conformes, états DSF, TVA UEMOA
2. **Import Sage transparent** — migration sans perte, mapping intelligent par IA
3. **Multi-organisations** — un cabinet gère plusieurs dossiers clients sous le même login
4. **Audit complet** — toute écriture est traçable, immuable, signée
5. **Workflows de validation** — séparation préparateur / valideur / approbateur

## Brand Tone

- **Sérieux mais humain** — pas le sérieux glacial des banques d'affaires, pas la familiarité d'une app grand public
- **Calme** — l'interface ne crie jamais. Pas de notifications agressives, pas de couleurs vives par défaut
- **Précis** — chaque mot compte. Vocabulaire comptable exact (« écriture », « passation », « lettrage »), jamais de jargon SaaS
- **Confiant** — n'a pas besoin de rassurer en permanence avec des emojis ou « Génial ! » à chaque action
- **Local sans folklore** — ancré en Côte d'Ivoire et OHADA, mais sans drapeaux, sans bogolan, sans accents touristiques

## Voice — Examples

- ❌ « Vos données ont été enregistrées avec succès ! 🎉 »
- ✅ « Écriture enregistrée. Pièce n° JV-2026-0512. »

- ❌ « Oups, une erreur s'est produite. »
- ✅ « Le journal est verrouillé. Demandez à un valideur de rouvrir la période. »

- ❌ « Nos algorithmes IA boostent votre productivité. »
- ✅ « 12 propositions de lettrage automatique. Validez ou ajustez. »

## Anti-References

Ce que ce produit **ne doit pas ressembler à** :

- **Sage Saari** — interface Windows 98, formulaires denses sans hiérarchie, gris industriel. La référence à dépasser.
- **Banques en ligne ivoiriennes** (Ecobank, NSIA Banque app) — navy + or, dégradés métalliques, sensation de luxe vide
- **SaaS startup américain générique** — gradient violet/rose, hero-metric, cards égales, "Welcome back 👋"
- **Apps fintech glassmorphism** (Revolut-likes) — blurs et néon, déconnecté du travail comptable réel
- **Microsoft Dynamics** — ribbons surchargés, paradigme bureautique des années 2010
- **Notion-clone** — minimalisme paresseux, blanc clinique, neutres non tintés

## Strategic Principles

1. **Densité > sparsité** — un comptable veut voir 50 lignes d'écritures, pas 5 cards XXL. Le whitespace est intentionnel, pas généreux par défaut.
2. **Lecture diagonale optimisée** — typographie tabulaire systématique, alignement décimal des montants, débits/crédits sur deux colonnes distinctes
3. **Pas de cliché-catégorie** — refuser navy+or, refuser le dark theme par défaut, refuser le hero avec gros chiffre
4. **Réversibilité par défaut** — toute action critique a un undo visible, une trace dans l'audit log
5. **Vitesse de saisie** — raccourcis clavier comme citoyens de première classe (⌘K palette, navigation Tab/Enter cohérente)
6. **Confiance par la traçabilité** — montrer qui a fait quoi, quand, est plus rassurant qu'un badge "Sécurisé ✓"
7. **Mode d'apprentissage** — labels métier OHADA explicites, hints contextuels pour les juniors, jamais condescendants

## Constraints

- **Langue** — français Côte d'Ivoire (FR-CI). Pas d'anglicismes inutiles ("dashboard" → "tableau de bord", mais "workflow" et "audit log" restent métier OHADA acceptés)
- **Devise** — FCFA (XOF) primaire, EUR secondaire, USD tertiaire. Format `1 234 567 FCFA` (espace fine insécable comme séparateur)
- **Conformité** — RGPD (clientèle européenne via filiales), exigences OECCI pour la traçabilité
- **Performance** — beaucoup de cabinets travaillent en 4G, certains en 3G. Bundle JS < 200 kb gzip sur les routes critiques.
- **Accessibilité** — WCAG 2.2 AA minimum. Contraste élevé non négociable (les comptables vieillissent et leurs yeux aussi).
