# DESIGN — ERP Compta OHADA

> Système de design — direction **Éditorial papier ivoire**. Light theme warm, typographie éditoriale, accent unique, densité comptable.

## Direction

Sérénité de la salle d'archives d'un cabinet historique. Papier ivoire, encre noire chaude, marges intentionnelles, chiffres alignés. Refus explicite du SaaS générique (gradients, blanc clinique, gros KPIs).

## Color Strategy

**Restrained** — fond + texte tintés chaud, un seul accent vert profond utilisé < 8 % de la surface (états de validation + CTA primaire). Critical rouge brique réservé aux erreurs/passifs. Aucun dégradé décoratif.

### Tokens (OKLCH)

```
                              Light                                Notes
─────────────────────────────────────────────────────────────────────────
canvas             oklch(98.5% 0.005 85)        Papier ivoire — fond app
paper              oklch(99.2% 0.004 85)        Surface élevée (cartes, popovers)
sunk               oklch(96.5% 0.006 85)        Zones enfoncées (inputs, table headers)
ink                oklch(18% 0.008 270)         Texte primaire (noir tinté froid pour contraste)
ink-soft           oklch(38% 0.010 270)         Texte secondaire
ink-mute           oklch(58% 0.012 270)         Texte tertiaire, hints
line               oklch(90% 0.006 85)          Bordures discrètes
line-strong        oklch(82% 0.008 85)          Bordures structurelles (table, séparateurs)

accent             oklch(45% 0.10 155)          Vert profond — validation, CTA primaire
accent-soft        oklch(94% 0.025 155)         Fond pâle pour badges/highlights
accent-ink         oklch(28% 0.08 155)          Texte sur fond accent-soft

critical           oklch(52% 0.18 25)           Rouge brique — erreurs, passifs
critical-soft      oklch(95% 0.035 25)
critical-ink       oklch(32% 0.12 25)

warn               oklch(68% 0.13 75)           Ocre — avertissements (rare)
warn-soft          oklch(95% 0.030 75)

info               oklch(52% 0.09 240)          Bleu encre — info passive
info-soft          oklch(95% 0.020 240)
```

**Règles de pigment** :
- Jamais `#000` ni `#fff`. `ink` est tinté froid, neutres tintés chaud.
- Chroma bas (0.005-0.012) sur les neutres → chaleur du papier sans saturation
- L'accent vert n'est jamais utilisé pour la décoration, uniquement pour signifier validité/action

## Typography

Pair éditoriale — **serif pour les titres de hiérarchie 1-2**, **sans-serif moderne pour l'UI**, **mono pour les montants et identifiants**.

### Familles

| Rôle | Famille | Justification |
|---|---|---|
| Display + h1, h2 de section | **Fraunces** (Google Fonts, variable) | Serif contemporaine avec opsz variable. Donne le caractère « cabinet historique » sans tomber dans le pastiche. |
| UI, body, h3+, labels, boutons | **Geist Sans** (Google Fonts, variable) | Geometric sans neutre, optimisée écran, 9 graisses. Lisibilité chiffres excellente. |
| Montants, codes comptes, IDs | **Geist Mono** (Google Fonts, variable) | Tabular par construction. Distingue O/0, l/1/I sans ambiguïté. |

### Échelle

Ratio 1.250 (Major Third), base 14px pour UI dense.

```
text-2xs   11px / 16px line   tracking +0.02em uppercase   captions, labels secondaires
text-xs    12px / 18px        tracking +0.01em             metadata, hints
text-sm    14px / 22px                                     UI body (défaut)
text-base  16px / 26px                                     prose, formulaires
text-lg    18px / 28px                                     emphasis paragraphes
text-xl    22px / 32px        Geist Sans 600               h3 de section, titres de tableau
text-2xl   28px / 38px        Fraunces 500, opsz 28        h2 de page
text-3xl   38px / 46px        Fraunces 500, opsz 38        h1 de page
text-4xl   52px / 60px        Fraunces 500, opsz 52        titres de marque (login, marketing only)
```

### Règles typographiques

- `font-feature-settings: 'tnum' 1, 'cv11' 1, 'ss01' 1, 'calt' 1` global → chiffres tabulaires partout
- `font-variation-settings: 'opsz' auto` sur Fraunces → optical sizing automatique
- Body line-length cappée à **68ch** sur les pages de prose (settings, doc, audit detail)
- Pas de italic pour l'emphase UI — utiliser `font-medium` (500) ou couleur
- Italic réservé aux références juridiques OHADA et aux exemples (« écriture, voir SYSCOA art. 14 »)
- Tracking serré sur Fraunces (`-0.015em` sur les gros titres), normal sur Geist

## Spacing & Density

Échelle de 4px (baseline grid). Densité comptable — beaucoup d'information visible sans scroll.

```
space-1   4px      gutters fins, gap badges
space-2   8px      espacement intra-cellule
space-3   12px     padding vertical inputs
space-4   16px     gap entre éléments d'une même zone
space-5   20px     padding cartes denses
space-6   24px     section spacing dans une page
space-8   32px     entre blocs majeurs
space-10  40px     headers de page
space-12  48px     marge supérieure de page (rare)
```

**Hauteurs de ligne pour les tables comptables** : 32px par ligne (pas 40-48px). Densité = 30+ lignes visibles sur écran 1080p sans scroll.

**Inputs** : `h-9` (36px), pas `h-10` (40px) ni `h-12` (48px SaaS).

**Buttons** : `h-8` sm / `h-9` md / `h-10` lg. Défaut = md.

## Radius

```
radius-xs   2px      badges, inline highlights
radius-sm   4px      inputs, boutons, cellules
radius-md   6px      cartes, popovers (DÉFAUT)
radius-lg   8px      modales, panneaux
radius-xl   12px     hero containers (rare)
```

Pas de `rounded-2xl` ni `rounded-3xl` — réflexe SaaS friendly à éviter.

## Elevation

Plat par défaut. Élévation par **bordure tintée** d'abord, ombre **uniquement** pour les surfaces flottantes (popovers, dropdowns, command palette).

```
shadow-pop      0 1px 2px oklch(18% 0.008 270 / 0.06),
                0 8px 24px oklch(18% 0.008 270 / 0.08)   popovers, dropdowns

shadow-modal    0 4px 12px oklch(18% 0.008 270 / 0.10),
                0 32px 64px oklch(18% 0.008 270 / 0.14)  modales (rare)

shadow-input    inset 0 1px 0 oklch(18% 0.008 270 / 0.04)  focus state
```

Pas de `shadow-sm` sur les cards par défaut. Utiliser `border-line` à la place.

## Motion

Discret, fonctionnel. Pas d'animations décoratives.

```
duration-fast    120ms       hover, focus, toggles
duration-base    180ms       transitions de panneau, sidebar
duration-slow    280ms       page transitions, drawer entry
ease-out-quart   cubic-bezier(0.165, 0.84, 0.44, 1)
ease-out-quint   cubic-bezier(0.23, 1, 0.32, 1)
```

- **Animer uniquement** : `opacity`, `transform`, `clip-path`
- **Jamais** : `width`, `height`, `padding`, `border-width`
- Pas de bounce, pas de spring élastique
- Respecter `prefers-reduced-motion`

## Iconographie

`lucide-react` — `stroke-width: 1.5` par défaut (pas 2). Taille 16px en UI, 20px en titres de section, 14px en métadonnées.

Pas d'icône décorative — chaque icône doit signifier une action ou un état.

## Composants — règles spécifiques

### Cards
- Bordure `line`, fond `paper`, radius `md`
- Pas d'ombre par défaut
- Padding `space-5` (20px)
- Header = `text-xs uppercase tracking-wider ink-mute` puis valeur en taille plus grande
- **Jamais de cards uniformes en grille égale** — varier les tailles, casser la grille

### Buttons
- Primary = fond `accent`, texte blanc-ivoire, radius `sm`
- Secondary = fond `paper`, bordure `line-strong`, texte `ink`
- Ghost = texte `ink-soft`, hover `sunk`
- Destructive = fond `critical`, texte blanc-ivoire (utilisation rare)
- **Pas de boutons gradient, pas de shadow on hover**

### Inputs
- Fond `paper`, bordure `line-strong`, radius `sm`
- Focus = bordure `accent`, shadow `shadow-input`
- Labels au-dessus en `text-xs ink-soft tracking-wider`, pas de floating labels

### Tables (cœur de l'app comptable)
- Header sticky, fond `sunk`, texte `text-xs uppercase tracking-wider ink-mute`
- Lignes 32px, bordure `line` entre les lignes
- Montants alignés à droite, mono, tabulaire
- Codes comptes en mono
- Ligne hover = fond `sunk` à 50%
- Ligne sélectionnée = fond `accent-soft`
- **Zebra stripes interdites** — réflexe Excel daté

### Badges / chips
- `text-2xs uppercase tracking-wider`, padding `2px 8px`, radius `xs`
- État validé = `bg-accent-soft text-accent-ink`
- État erreur = `bg-critical-soft text-critical-ink`
- État neutre = `bg-sunk text-ink-soft`

## Pages — Layout patterns

### Page standard authentifiée
```
┌──────────────────────────────────────────────────────────────┐
│  TOPBAR : logo · org switcher · période active · ⌘K · user   │
├─────────────┬────────────────────────────────────────────────┤
│             │  PAGE HEADER                                   │
│  SIDEBAR    │   h1 Fraunces · sous-titre ink-soft · actions  │
│  groupée    ├────────────────────────────────────────────────┤
│  par        │                                                │
│  domaine    │  CONTENU                                       │
│             │                                                │
│  240px      │  max-width none (compta = pleine largeur)      │
│  fixe       │                                                │
└─────────────┴────────────────────────────────────────────────┘
```

### Sidebar — grouping
1. **Pilotage** — Tableau de bord, Dashboards, Score santé
2. **Référentiel** — Plan comptable, Périodes, Devises
3. **Saisie** — Journaux, Workflow écritures, Imports
4. **Retraitements** — Lettrage, Rapprochement, Transformations, Règles
5. **États** — États financiers, TVA, Inventaire, Immobilisations
6. **IA & Automation** — IA Anomalies, Workflows
7. **Organisation** — Membres, Invitations, Collaboration, Audit, MFA, Documents

## Anti-patterns à refuser

- ❌ Card grid uniforme icône + titre + texte × N
- ❌ Hero metric XXL avec gros chiffre + delta vert/rouge
- ❌ Gradient text (`bg-clip-text`)
- ❌ Glassmorphism
- ❌ Side-stripe colorées (border-left 4px accent)
- ❌ Em dashes (`—` dans le copy, OK dans la doc design)
- ❌ Zebra stripes sur les tables
- ❌ Skeleton loaders animés "shimmer" décoratifs (préférer fade-in une fois chargé)
- ❌ Toasts qui rebondissent
- ❌ Empty states avec illustration générique « personnage qui cherche »
