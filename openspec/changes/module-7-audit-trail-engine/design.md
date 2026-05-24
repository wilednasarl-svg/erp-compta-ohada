## Context

Le journal `auth_events` du Module 1 a rapidement dérivé sémantiquement avec les modules 2 et 3. Une table appelée « auth_events » qui contient `chart_of_accounts.account_created` ou `imports.file_uploaded` est un anti-pattern de nommage qui se paie en confusion documentaire et en code review difficile. Plus important : le shape original (`event_type`, `metadata: jsonb`) ne capturait pas les **diffs** (avant/après pour les updates) ni l'**entité ciblée** — sans ces colonnes, l'écran d'audit d'un cabinet ne peut pas répondre à « qui a changé quoi sur le compte 411 d'Acme le 12 avril ».

Le Module 7 normalise tout ça en posant `audit_logs` comme **journal unifié** et `AuditTrailService` comme service unique pour l'écriture. La migration est rétro-compatible : `auth_events` devient une vue Postgres filtrée sur les modules d'auth/org/rbac, donc Module 1 et ses tests n'ont rien à changer.

## Key Decisions

### D1 — Rename `auth_events` en `audit_logs` plutôt que créer une nouvelle table en parallèle

**Décision :** la migration 0019 fait `ALTER TABLE auth_events RENAME TO audit_logs` plutôt que `CREATE TABLE audit_logs` + dual-write.

**Alternatives écartées :**
- **Dual-write** vers les deux tables pendant une période de transition → complexifie chaque service métier, doublons en lecture, divergence inévitable au moindre bug.
- **Nouvelle table sans rename** + suppression de `auth_events` après migration des données → fenêtre de migration sans audit trail, casse les tests e2e de Module 1.

**Conséquence :** la vue Postgres `auth_events` filtrée sur `module IN ('auth','organizations','rbac')` préserve la back-compat pour `AuthEventRepository` du Module 1. Les insertions Module 1 passent par `AuthEventsService.record()` qui injecte `module = 'auth'` (ou `'organizations'`, ou `'rbac'`) automatiquement. Migration atomique, zéro downtime.

### D2 — Module = string union typée côté code, mais TEXT côté DB

**Décision :** la colonne `module` est `TEXT` au niveau Postgres (pas un ENUM SQL), avec une CHECK constraint optionnelle qui peut être ajoutée plus tard sans schema lock-in. Côté TypeScript, `AuditModule` est une string union (`'auth' | 'organizations' | ...`) qui force les call-sites à passer une valeur connue.

**Rationale :** un futur module (ex: `'inventory'`) doit pouvoir s'ajouter par **une ligne de code** dans le type union — pas par une migration ALTER TYPE Postgres. Le bénéfice "validation au plus tôt" est de toute façon obtenu par TypeScript au compile-time.

### D3 — `before` et `after` JSONB nullable, pas de schéma figé

**Décision :** `before` et `after` sont des `jsonb` libres. Les call-sites passent les colonnes pertinentes qu'ils veulent capturer. Pas de validation côté DB sur leur shape.

**Rationale :**
- Schéma figé = chaque évolution d'entité (Module 4 écritures, Module 5 reports…) impose une migration.
- Pas de schéma = liberté maximale + indexabilité préservée via JSONB GIN si besoin (« show me every change that modified `account_code` to `411` »).

**Trade-off accepté :** un call-site peut écrire des JSONB malformés. Mitigation : les services métier (jamais le controller) sont les seuls writers, et leur signature `record({ before, after })` est typée par TypeScript via `AuditRecordOptions`.

### D4 — Append-only enforced par absence d'endpoints, pas par triggers

**Décision :** aucun endpoint `PATCH /audit/logs/:id` ni `DELETE` n'existe ni n'est prévu. Le service ne publie qu'une méthode `record()`. Il n'y a pas de DB trigger qui interdit les UPDATE/DELETE sur la table.

**Rationale :** la défense via API est suffisante en pratique (toute l'écriture passe par le service), et un trigger interdirait aussi les migrations futures légitimes (ajout de colonne, correction d'un mauvais index). Pour un cabinet OHADA dont la DB est administrée par notre équipe + Supabase, le risque "insider DB edit" est couvert par les access logs Postgres niveau hosting.

**Si la conformité IFRS / OHADA exige plus :** un trigger BEFORE UPDATE/DELETE qui RAISE EXCEPTION sera ajouté en migration ultérieure (issue beads de suivi).

### D5 — Vue Postgres `auth_events` filtrée, pas une simple view sur toutes les lignes

**Décision :** la vue `auth_events` filtre `WHERE module IN ('auth', 'organizations', 'rbac')`. Les modules métier (chart, imports, documents) n'apparaissent PAS dans la vue.

**Rationale :** `AuthEventsController` (Module 1) expose `GET /organizations/:id/auth-events` avec une promesse spec implicite « événements d'auth pour cette org ». Si la vue exposait *tout*, l'API du Module 1 retournerait soudain les actions plan comptable / imports — surprise et drift de spec. La vue filtrée garantit que Module 1 reste cohérent avec ce qu'il documentait, et les consommateurs d'audit moderne lisent `GET /audit/logs` qui ne filtre rien.

## Risks

1. **Drift entre `auth_events` view et lecture controllers** — si une feature future ajoute un module qui doit apparaître dans `auth_events` (par exemple un futur `'sso'` qui est conceptuellement auth), il faut ALTER VIEW. Atténué par la liste fermée des modules dans la vue ; tests e2e Module 1 valident la cohérence.

2. **JSONB non normalisé** — les requêtes « tous les events qui modifient le champ X » nécessitent un index JSONB GIN sur `(before, after)`. Pas créé en vague 1. Ajouter si le dashboard d'audit en a besoin (issue suivi).

3. **Pas de retention policy** — les `audit_logs` grossissent linéairement avec l'activité utilisateur. Aucun TTL ni partitioning posé. Acceptable pour MVP single-tenant ; **doit être adressé avant le go-live multi-cabinet** (rule de retention 7 ans selon OHADA → partitioning par année + archivage froid).
