## Context

Le Module 3 (imports) a livré les écritures brutes en table de staging (`import_staging_entries`). Le Module 4 wave 2 (journaux / entries) consommera ces écritures pour produire les écritures comptables réelles. Entre les deux, le cabinet doit pouvoir retraiter : reclasser un compte mal codé par la banque, ajouter une régularisation de fin de période, corriger un libellé — toutes opérations qui, si elles écrasaient la ligne source, ruineraient la traçabilité exigée par OHADA et le commissariat aux comptes.

Le présent module pose cette couche intermédiaire : un journal de retraitements append-only où chaque transformation est un artefact additionnel lié à une écriture source, jamais une mutation de cette source. C'est la garantie minimale pour qu'un auditeur puisse, plusieurs mois après, retracer la chaîne « ligne brute banque → reclassement comptable n°1 → ajustement de régularisation → écriture finale au journal ».

## Goals

- Permettre au comptable de reclasser et ajuster des écritures issues d'imports sans toucher la donnée source.
- Conserver un historique chronologique complet par écriture source, incluant les transformations annulées (soft-delete via `status = cancelled`).
- Exposer un service consommable par Module 4 wave 2 (journaux) pour appliquer la chaîne « source + transformations actives » au moment du commit.
- Tracer chaque mutation dans `audit_logs` (Module 7) avec diff before/after.

## Non-Goals

- **Pas de mutation de la ligne source** : `import_staging_entries.raw_values` et `mapped_values` ne sont jamais modifiés par ce module.
- **Pas de commit vers les écritures comptables réelles** : c'est le périmètre du Module 4 wave 2 (`module-4-journals-entries`). Le présent module produit l'intention de retraitement, pas l'écriture finale.
- **Pas d'undo/redo end-to-end** : le soft-delete (`status = cancelled`) est posé en schéma, mais l'API d'annulation n'est pas exposée en vague 1 (sortira en vague 2 avec un endpoint dédié `POST /transformations/:id/cancel`).
- **Pas de ventilation / grouping en vague 1** : les types `correction`, `ventilation`, `grouping` sont au catalogue `TransformationType` pour ne pas refaire de migration plus tard, mais les endpoints / DTOs ne couvrent que `reclassification` et `adjustment` en wave 1.
- **Pas de frontend** : périmètre backend uniquement, comme Modules 2 et 3 en wave 1.

## Key Decisions

### D1 — Immuabilité des écritures sources : invariant strict, jamais d'UPDATE sur `import_staging_entries`

**Décision :** aucune route HTTP du module ne fait `UPDATE` sur `import_staging_entries`. La table de staging est traitée en read-only par le service. Toute modification logique d'une écriture passe exclusivement par la création d'un artefact `entry_transformations`.

**Alternatives écartées :**
- **Rewrite in-place** des `mapped_values` du staging → simplifie la lecture par Module 4 wave 2 (un seul row à consulter) mais détruit l'audit trail : impossible de retracer ce que la banque a réellement envoyé après plusieurs retraitements. Disqualifié par les exigences OHADA / commissariat aux comptes.
- **Versioning de la table staging** (clone de la ligne à chaque modification) → double l'espace disque et complique les FK vers `import_files` ; pas mieux qu'une table de diffs dédiée.

**Conséquence :** la lecture « état effectif d'une écriture » à consommer par Module 4 wave 2 nécessitera de composer source + chain de transformations actives (par `created_at` ascendant). C'est plus complexe en lecture mais explicite et auditable. Le service `TransformationService` est exporté du module dans ce but.

### D2 — Transformations stockées en JSONB sparse (`before_values` / `after_values`), pas en colonnes typées

**Décision :** les colonnes `before_values` et `after_values` sont des `jsonb NOT NULL DEFAULT '{}'` qui ne capturent que les champs effectivement modifiés (diff sparse), pas la ligne complète. Côté TypeScript, `TransformationDiff` est un type `Partial<Record<ReclassifiableField, string | null>>` étendu des champs spécifiques `adjustment*`.

**Rationale :**
- Un schéma figé (colonnes `new_account`, `new_journal`, `new_label`…) impose une migration ALTER TABLE à chaque nouveau type de retraitement (ex: ajouter `correction_date` en vague 2).
- Sparse JSONB rend l'audit lisible : pour un reclassement qui ne change que le compte, on voit `{"account": "4111"}` et pas une ligne complète où 8 colonnes sur 9 répètent la valeur source.
- Indexabilité préservée : GIN sur `before_values` / `after_values` si le dashboard d'audit veut « toutes les transformations qui ont changé `account` vers `411%` » — pas créé en wave 1, ajout possible sans migration de schéma.

**Trade-off accepté :** validation du shape côté DB impossible. Mitigation : les call-sites sont uniquement le service (jamais un controller direct), et la signature TypeScript de `CreateTransformationInput` force le typage.

### D3 — Séparation reclassement vs ajustement : deux endpoints, deux DTOs, deux contraintes business

**Décision :** `reclassify` et `adjust` sont des endpoints distincts avec des DTOs distincts et des contraintes business distinctes, plutôt qu'un endpoint générique `POST /transformations` avec un discriminateur `type`.

**Rationale :**
- Le **reclassement** modifie le mapping d'une écriture existante (compte / journal / partner / label) — il peut toucher 1 à 4 champs, au moins 1 obligatoire. Contrainte : `TRANSFORMATION_NO_FIELD_CHANGED` si aucun champ fourni.
- L'**ajustement** ajoute une écriture de régularisation liée à la source (un montant de plus en débit OU crédit, jamais les deux) avec un libellé propre. Contrainte : `TRANSFORMATION_ADJUSTMENT_INVALID` si les deux ou aucun sont fournis (XOR strict).
- Les deux n'ont rien en commun en termes de validation. Un DTO union avec `oneOf` complexifie class-validator sans bénéfice.

**Conséquence :** controllers + DTOs + branches du service sont plus longs, mais chaque chemin est trivialement lisible et testable. Les futurs types (`correction`, `ventilation`, `grouping`) suivront le même pattern (un endpoint + un DTO + une branche de service par type).

### D4 — Tenant isolation par JOIN sur `import_sessions`, pas par dénormalisation

**Décision :** `import_staging_entries` ne porte pas de colonne `organization_id` directe (elle dépend de `import_files → import_sessions → organization_id`). Le service `TransformationService.resolveSourceEntry` fait un `INNER JOIN ImportSessionEntity` dans son query builder pour vérifier que l'écriture source appartient bien au tenant courant. Cross-tenant access → `TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` (fail-closed 404).

**Alternatives écartées :**
- **Dénormaliser `organization_id` sur `import_staging_entries`** → simplifie la query mais nécessite une migration ALTER + backfill + maintenir la cohérence par trigger ou code. Risque de drift.
- **Stocker `organization_id` sur `entry_transformations` ET vérifier la cohérence avec la session source au moment du write** → vérification fait double emploi avec le JOIN ; complique la couche repository.

**Rationale :** `entry_transformations.organization_id` est posé en colonne propre (FK org direct) pour permettre les requêtes dashboard (toutes les transformations d'une org), mais la vérification de cohérence avec la source passe systématiquement par le JOIN — la source de vérité tenant reste `import_sessions.organization_id`. Tenant leak impossible : si le JOIN ne trouve rien, l'API répond 404 sans révéler si l'écriture existe ailleurs.

## Risks

1. **Drift entre chaîne de transformations et écriture source** — si une session d'import est supprimée (CASCADE), toutes les transformations attachées sont aussi supprimées (FK `source_entry_id` ON DELETE CASCADE). Comportement voulu : on ne garde pas de transformations orphelines. Risque résiduel : un comptable peut perdre son travail de retraitement si un admin purge une session. Mitigation à prévoir : restreindre la suppression de sessions ayant des transformations actives (issue suivi).

2. **Pas de validation business sur les diffs JSONB** — un appel direct au service avec un `TransformationDiff` malformé est possible. Acceptable en wave 1 (le service est le seul writer), mais à durcir si on expose le service à d'autres modules (ex: pour ventilation où le diff sera plus complexe).

3. **Pas d'API d'annulation en wave 1** — le soft-delete est posé en schéma (`status = cancelled` + `cancelled_at` + `cancelled_by_id` + `cancel_reason`) mais aucun endpoint ne le déclenche. Risque : un comptable qui se trompe doit demander à un admin un fix DB direct. Acceptable en wave 1 (volume faible), à livrer en vague 2 avec `POST /transformations/:id/cancel`.

4. **Performance lecture history** — `getEntryHistory` retourne toutes les transformations (actives + annulées) ordonnées chronologiquement. Pour une écriture très souvent retraitée (théoriquement non-borné), la query peut grossir. Mitigation : index `(organization_id, source_entry_id)` couvre la requête ; pagination peut être ajoutée si besoin.
