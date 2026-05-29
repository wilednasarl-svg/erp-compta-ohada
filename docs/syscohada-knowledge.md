# Socle de connaissance SYSCOHADA

Le projet dispose d'un socle documentaire transversal exposé par
`SyscohadaKnowledgeModule`.

## Source doctrinale

La source prioritaire est le Guide d'application SYSCOHADA révisé partagé dans
`.local/sources/` :

- Tome 1 : opérations courantes
- Tome 2 : opérations et problèmes spécifiques
- Tome 3 : états financiers annuels
- Tome 4 : comptes consolidés et combinés

Le module lit les textes extraits `*.pdf.1-end.txt`. En production, le chemin
peut être fixé avec `SYSCOHADA_KNOWLEDGE_DIR`.

## Usage par les modules

Le module est global côté NestJS. Les modules métier peuvent injecter
`SyscohadaKnowledgeService` pour rechercher une référence doctrinale ou exposer
leurs contrôles avec une citation SYSCOHADA.

Domaines couverts par la cartographie initiale :

- `accounting-plan`
- `journals`
- `assets`
- `inventory`
- `tva`
- `reports`
- `ai`

L'assistant IA est le premier consommateur visible : les questions de doctrine
SYSCOHADA interrogent ce socle avant les anciennes heuristiques SQL.

## API transversale

Le référentiel est aussi exposé à tous les écrans et modules via des routes
publiques en lecture seule :

- `GET /syscohada-knowledge/domains` : domaines métier avec références,
  contrôles et extraits citables du Guide.
- `GET /syscohada-knowledge/domains/:domain` : doctrine d'un module précis.
- `GET /syscohada-knowledge/domains/:domain/controls` : catalogue des contrôles
  et validations du module, chacun avec base légale (AUDCIF + tome) et extrait
  verbatim du Guide.
- `GET /syscohada-knowledge/search?domain=reports&query=bilan` : recherche dans
  les PDF extraits avec tome, fichier source et lignes.

## Catalogue de contrôles

`data/control-catalog.ts` énumère les contrôles métier nommés par domaine
(`SYSCOHADA_CONTROL_CATALOG`). Chaque contrôle porte :

- une **sévérité** (`blocking` / `warning` / `info`) ;
- une **base légale explicite** : seuls les articles de l'Acte uniforme (AUDCIF)
  à formulation stable sont cités directement (art. 8 composition des états,
  art. 17 partie double, chronologie et inventaire) ; le reste renvoie au tome
  et au chapitre du Guide d'application ;
- une **citation verbatim** rapatriée à l'exécution depuis les PDF
  (`evidenceQuery`), garantissant la traçabilité même quand la base légale
  pointe le Guide plutôt que l'AUDCIF.

Exemples : équilibre de l'écriture en partie double (journaux, bloquant),
bilan Actif = Passif (états financiers, bloquant), dépréciation à l'inventaire
(immobilisations et stocks), centralisation TVA post-déclaration.

L'écran frontend `/syscohada-knowledge` consomme ces endpoints pour rendre les
citations SYSCOHADA visibles module par module, contrôles inclus. Les prochains
renforcements métier doivent réutiliser ce catalogue pour brancher les
validations applicatives (refus de clôture, alertes de cohérence) sur une source
réglementaire explicite plutôt que sur des règles isolées.
