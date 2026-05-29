# Report Console — Critères d'acceptation & tests utilisateurs

Format : `Given / When / Then`. Statut **[P]** = vérifiable dès maintenant sur le
prototype `/reports/console` ; **[I]** = à vérifier après intégration backend.

---

## 1. Champ de période (`DateRangeField`)

- **AC-P1** [P] *Given* le champ fermé, *When* je clique dessus, *Then* un popover
  s'ouvre avec rail de presets + calendrier + saisie manuelle, sans recharger la page.
- **AC-P2** [P] *Given* le popover ouvert, *When* je choisis « Clôture N-1 » (mode
  arrêté), *Then* la date d'arrêté passe au 31/12 N-1 et le début d'exercice au 01/01 N-1.
- **AC-P3** [P] *Given* une sélection correspondant exactement à un preset, *Then* ce
  preset est visuellement actif (`aria-pressed=true`).
- **AC-P4** [P] *Given* le popover ouvert, *When* je presse `Échap`, *Then* il se ferme
  et le focus revient sur le déclencheur.
- **AC-P5** [P] *Given* le calendrier focalisé, *When* j'utilise les flèches, `Origine`,
  `Fin` puis `Entrée`, *Then* je navigue jour à jour / semaine et sélectionne sans souris.
- **AC-P6** [P] *Given* le mode plage, *When* je clique une date basse puis une date
  haute, *Then* l'intervalle entre les deux est surligné et `Du/Au` se mettent à jour.

## 2. Indice de validité (`DataValidityStrip`)

- **AC-V1** [P] *Given* le scénario « saine », *Then* « écritures » et « Journal
  équilibré » s'affichent en `accent` (sain).
- **AC-V2** [P] *Given* le scénario « déséquilibré », *Then* l'écart Σdébit−Σcrédit
  s'affiche en FCFA, en `critical`, et un avertissement de non-conformité apparaît.
- **AC-V3** [P] *Given* le scénario « vide », *Then* « Aucune écriture » s'affiche en
  `warn` et l'info-bulle précise que l'état généré sera vide.
- **AC-V4** [P] *Given* chaque indicateur, *When* je le survole **ou** le focalise au
  clavier, *Then* une info-bulle accessible explique la mesure (pas un `title=`).
- **AC-V5** [I] *Given* une période sélectionnée, *Then* l'indice reflète les vraies
  écritures committées de l'organisation courante (query backend).

## 3. Génération & feedback (`GenerationProgress`)

- **AC-G1** [P] *Given* l'état idle, *When* je clique « Générer », *Then* une barre
  déterminée progresse de 0 à 100 % avec libellé d'étape et estimation restante.
- **AC-G2** [P] *Given* la génération en cours, *Then* le bouton « Générer » est désactivé.
- **AC-G3** [P] *Given* la fin de génération, *Then* le résultat s'affiche (fade-in),
  une barre d'export PDF/Excel apparaît, et l'exécution est ajoutée à l'historique.
- **AC-G4** [P] *Given* `prefers-reduced-motion`, *Then* la barre ne s'anime pas par
  transition mais reflète la progression sans mouvement superflu.

## 4. Favoris & Historique (`stores.ts`)

- **AC-F1** [P] *Given* une sélection période + périmètre, *When* je la nomme et
  l'enregistre, *Then* elle apparaît dans le menu Favoris.
- **AC-F2** [P] *Given* un favori, *When* je le sélectionne, *Then* période **et**
  périmètre (ex. comparer N-1) sont restaurés.
- **AC-F3** [P] *Given* un favori enregistré, *When* je recharge la page, *Then* il est
  toujours présent (persistance localStorage).
- **AC-F4** [P] *Given* au moins une génération, *Then* le menu « Récent » liste les
  dernières exécutions (max 8) avec date et durée (« généré en 1,2 s »).
- **AC-F5** [P] *Given* deux dossiers (orgId) différents, *Then* leurs favoris/historique
  ne se mélangent pas (clé `${orgId}:${mode}`).

## 5. Guide & responsive (`ReportRunner`)

- **AC-R1** [P] *Given* un état avec périmètre, *Then* le guide montre ① Période ›
  ② Périmètre › ③ Générer ; sans périmètre, seulement ① et ②.
- **AC-R2** [P] *Given* un résultat prêt, *Then* l'étape « Générer » est marquée faite.
- **AC-R3** [P] *Given* une fenêtre étroite (≤ 768 px), *Then* la toolbar passe à la
  ligne sans débordement horizontal.

---

## 6. Scénarios de test utilisateur

### 6.1 Comptable / expert-comptable (quotidien, exigeant)

> *« Chaque matin je sors le Bilan arrêté au dernier jour clos, comparé à N-1. »*

1. Ouvrir `/reports/console`.
2. Vérifier que la validité montre l'équilibre **avant** de générer (AC-V1/V2).
3. 1er jour : régler arrêté + comparer N-1, enregistrer le favori « Bilan quotidien ».
4. Générer ; noter la durée affichée (AC-G1/G3).
5. Jours suivants : rejouer le favori en un clic, recharger pour prouver la
   persistance (AC-F2/F3).

**Succès** : sélection quotidienne ramenée à 1 clic ; déséquilibre détecté avant
génération ; tout au clavier possible.

### 6.2 Gestionnaire / dirigeant PME (occasionnel, non-spécialiste)

> *« Je veux voir où en est l'entreprise ce trimestre, sans connaître le plan SYSCOHADA. »*

1. Ouvrir `/reports/console` sans connaissance préalable.
2. Suivre le guide ① → ③ de haut en bas.
3. Choisir « Ce trimestre » dans les presets (pas de saisie de date).
4. Lire l'indice de validité ; ouvrir une info-bulle pour comprendre « équilibré ».
5. Générer et lire le résultat.

**Succès** : tâche accomplie sans aide ni saisie manuelle de date ; le vocabulaire
métier est explicité par les info-bulles ; aucune étape n'est devinée.

### 6.3 Novice OHADA / auditeur de passage (découverte, fiabilité)

> *« Je dois vérifier que cet état est fiable et savoir d'où il sort. »*

1. Activer le scénario « déséquilibré » (AC-V2).
2. Constater l'écart en FCFA + l'avertissement de non-conformité.
3. Vérifier que l'état reste générable **pour contrôle** mais signalé non conforme.
4. Consulter « Récent » pour voir quand et sur quelle période un état a été produit.
5. Activer « Période vide » et constater l'avertissement (AC-V3).

**Succès** : la fiabilité est lisible sans ouvrir le grand livre ; un état douteux
n'est jamais présenté comme définitif ; la traçabilité (historique) est immédiate.

---

## 7. Couverture de tests recommandée (post-intégration)

| Cible | Type | Points clés |
|-------|------|-------------|
| `presets.ts` | Unitaire | bornes des presets (date réf. injectée), `matchPreset`, `fromIso` sans glissement UTC |
| `stores.ts` | Unitaire | add/remove/record, limite à 8, cloisonnement par scope |
| `Calendar` | Composant | navigation clavier, sélection plage, bascule de mois |
| `DateRangeField` | Composant | ouverture/fermeture, Échap, application preset |
| Parcours complet | E2E (Playwright) | scénarios 6.1 → 6.3, captures 320/768/1024/1440 |
| A11y | axe + clavier | rôles, focus, contraste, `prefers-reduced-motion` |
