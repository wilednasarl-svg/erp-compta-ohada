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
