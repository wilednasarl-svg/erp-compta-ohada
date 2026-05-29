# Report Console — Spécifications fonctionnelles

Refonte du parcours de génération des états (`/reports`). Objectif : un parcours
unique, lisible par un profil occasionnel **et** efficace pour un expert, factorisant
les filtres aujourd'hui réimplémentés dans chacun des 16 panneaux.

Prototype haute-fidélité consultable : **`/reports/console`** (piloté par mock, sans backend).

---

## 1. Vue d'ensemble du parcours

```
┌ Guide en 3 temps ──────────────────────────────────────────────┐
│ ① Période  ›  ② Périmètre  ›  ③ Générer                         │
├─────────────────────────────────────────────────────────────────┤
│ [Période ▾]  [Périmètre…]            [★ Favoris] [⟳ Récent] [▶]  │  ← toolbar
├─────────────────────────────────────────────────────────────────┤
│ ✓ 4 287 écritures · ✓ Journal équilibré · Dernier mvt 29 déc.   │  ← validité
│ ▓▓▓▓▓▓░░░░ 62 % · Calcul des totaux… · ~0,8 s                    │  ← progression
├─────────────────────────────────────────────────────────────────┤
│ (résultat de l'état)                                            │
└─────────────────────────────────────────────────────────────────┘
```

Le **guide** se lit de haut en bas pour le novice ; l'**expert** agit directement
(preset clavier, favori rejoué, bouton Générer). Aucune branche d'UI différente :
une seule barre sert les deux profils.

---

## 2. Composants réutilisables

Tous les composants vivent dans `src/app/reports/_console/` et n'ont **aucune
dépendance backend** : ils reçoivent leurs données par props et émettent des
callbacks. Réutilisables hors `/reports` (TVA, immobilisations, inventaire…).

### 2.1 `DateRangeField`

Champ de période unique remplaçant les paires `<input type=date>` + presets
dispersées. Couvre deux sémantiques via l'union discriminée `PeriodValue` :

| Mode | Forme | États concernés |
|------|-------|-----------------|
| `range` | `{ kind:'range', fromDate, toDate }` | Balances, Grand livre, Journal, Marge |
| `as-at` | `{ kind:'as-at', asAtDate, fiscalYearStartDate }` | Bilan, Compte de résultat, Ratios, Annexe |

**Props**

| Prop | Type | Rôle |
|------|------|------|
| `value` | `PeriodValue` | Sélection courante (contrôlé) |
| `onChange` | `(next: PeriodValue) => void` | Émis à chaque modification |
| `label` | `string` | Libellé accessible du popover |

**Comportement** : déclencheur compact affichant le résumé lisible
(`summarizePeriod`). Au clic → popover contenant (a) un rail de presets, (b) un
calendrier (`Calendar`), (c) la saisie manuelle exacte. Bouton « Appliquer » ferme
et rend le focus au déclencheur.

**Accessibilité** : déclencheur `aria-haspopup="dialog"` + `aria-expanded` ;
popover `role="dialog"` étiqueté ; fermeture Échap + clic extérieur ; focus restitué.

### 2.2 `presets.ts` — presets & utilitaires de date

Helpers **purs, sans dépendance** (pas de date-fns). Dates calculées en fuseau
local (un arrêté du 31/12 ne doit pas glisser au 30/12 via UTC). Fonctions clés :

- `toIso(d)`, `fromIso(iso)`, `formatHuman(iso)`, `summarizePeriod(value)`
- `RANGE_PRESETS` : Ce mois · Mois dernier · Ce trimestre · Cet exercice · Exercice N-1
- `AS_AT_PRESETS` : Aujourd'hui · Fin du mois dernier · Clôture N-1
- `presetsFor(kind)`, `matchPreset(value)` (surligne le preset actif), `defaultPeriod(kind)`

Chaque preset accepte une **date de référence injectable** → testable sans geler l'horloge.

### 2.3 `InfoTip` — bulle d'aide accessible

Remplace les `title=` natifs (non focusables, non lisibles, non stylables).
Déclenchement **hover + focus clavier**, fermeture Échap, contenu riche,
`aria-describedby` correct. Props : `label` (texte lecteur d'écran), `children`.

### 2.4 `DataValidityStrip` — indice de validité

Répond, **avant** génération, aux trois questions du comptable :

1. **Y a-t-il des écritures ?** `committedEntries` → sinon « Aucune écriture » (warn).
2. **Le journal est-il équilibré ?** `imbalance` (Σdébit−Σcrédit) → écart en FCFA (critical).
3. **Données à jour / figées ?** `lastMovementDate`, `periodClosed`, fraîcheur `computedAt`.

Sémantique couleur stricte (`DESIGN.md`) : `accent` = sain · `critical` = bloquant ·
`warn` = attention. État de chargement (`loading`) tant que l'indice n'est pas calculé.

**Source de données** (wiring réel) : endpoint léger `GET /reports/validity?from&to`
renvoyant `PeriodValidity`, idéalement mis en cache TanStack Query (clé = org + période).

### 2.5 `GenerationProgress` — feedback de génération

Barre **déterminée par étape** + libellé d'étape + estimation restante, à la place
du spinner anonyme. `GENERATION_STAGES` fournit des libellés métier réutilisables
(agrégation → hiérarchie SYSCOHADA → totaux → mise en forme). Animation par
`transform: scaleX` (jamais `width`), `prefers-reduced-motion` respecté,
`role="progressbar"` avec `aria-valuenow`.

### 2.6 Favoris & Historique (`stores.ts`)

Stores **zustand + persist (localStorage)**, clés `${orgId}:${mode}` (cloisonnement
par dossier et par état).

- **Favoris** : combinaisons nommées période + périmètre, rejouables. `add` / `remove`,
  hook `useFavorites(orgId, mode)`. Persistant entre sessions (mémoire volatile actuelle perdue au reload).
- **Historique** : `HISTORY_LIMIT = 8` dernières générations (période, périmètre,
  durée). `record` / `clear`, hook `useHistory(orgId, mode)`.

### 2.7 `ReportRunner` — orchestrateur

Squelette de parcours agnostique du contenu. Reçoit période, slot « périmètre »,
validité, statut, progression, résultat (`children`). Gère le guide d'étapes, la
toolbar, favoris/historique, l'export et les états idle/running/ready/error.

**Props principales** : `orgId`, `mode`, `period`/`onPeriodChange`, `validity`,
`status`, `progress`, `onGenerate`, `onExport`, `scopeControls`, `scope`,
`onApplyScope`, `children`, `emptyHint`.

---

## 3. Intégration au backend réel (hors prototype)

Le prototype simule la génération. Pour brancher un état existant :

1. Remplacer `validity` par une query `useQuery(['validity', orgId, period])`.
2. Mapper l'état actuel (`PeriodFilter` / `AsAt`) vers `PeriodValue`.
3. `onGenerate` → `mutateAsync` de l'état ; pousser la progression réelle si
   l'API streame, sinon laisser `GenerationProgress` en mode indéterminé court.
4. À la réussite : `history.record(...)` avec la durée mesurée.
5. `children` = le tableau de l'état existant, inchangé.

Migration **incrémentale** : un état à la fois, sans toucher au monolithe
`reports/page.tsx` tant que tous ne sont pas portés.

---

## 4. Conformité transverse

- **Design** : tokens `paper/ink/line/accent/critical/warn`, `shadow-pop`,
  `font-display/mono`, `text-2xs`, transitions `duration-fast ease-out-quart`.
- **A11y** : navigation clavier complète (calendrier flèches/Origine/Fin/Entrée),
  rôles ARIA, focus management, contraste, `prefers-reduced-motion`.
- **Performance** : aucune nouvelle dépendance (popover/tooltip/calendrier maison) ;
  animations compositor-friendly ; budget bundle préservé.
- **Immutabilité** : stores produisent des copies, pas de mutation en place.
