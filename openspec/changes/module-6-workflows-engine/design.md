## Context

Un cabinet OHADA distingue deux temps dans la vie d'une donnée comptable : le **temps technique** (parsing, validation, structure correcte) et le **temps de gouvernance** (relecture, approbation par un expert, clôture). Le Module 3 a couvert le premier. Sans le second, on ne peut ni acter qu'une session d'import a été relue par un humain habilité, ni empêcher un opérateur de modifier des écritures appartenant à un exercice déjà clos.

Le Module 6 superpose ce cycle de gouvernance à n'importe quel objet métier via un moteur générique. Vague 1 : `import_session`. Vague 2 : `journal_entry` (Module 4), `report` (Module 5). La cible est passée en string union TypeScript (`WorkflowTargetType`) — l'extension future est une ligne de code, pas une migration.

## Goals / Non-Goals

**Goals (vague 1, ce change) :**
- Machine d'états documentée à 4 valeurs (`draft → in_review → approved → locked`) avec graphe statique partagé entre service et type system.
- Service unique `WorkflowService` réutilisable par n'importe quel module métier qui adopte un `WorkflowTargetType`.
- Journal append-only des transitions (`workflow_events`) — un audit interne au module, complémentaire de `audit_logs` du Module 7.
- Invariant `locked` exporté comme méthode `assertNotLocked(orgId, targetType, targetId)` — barrière cross-module.
- Séparation RBAC `write` vs `approve` au plus tôt (comptable soumet, chef_mission/expert/admin approuve).
- Audit trail systématique via `AuditTrailService` (module `workflows` déjà dans l'union du Module 7).

**Non-Goals (sortent en vague 2) :**
- Cibles `journal_entry` et `report` — pose Module 4/5 prérequise.
- Vérification granulaire `workflows.approve` côté service (aujourd'hui le graphe d'états empêche les sauts illégaux ; la séparation RBAC fine entre `write` et `approve` arrivera avec l'injection `MembershipRepository`).
- Workflow définitions configurables par tenant (le catalogue `workflow_definitions` existe pour préparer le futur, mais en vague 1 une seule définition active est seedée).
- Notifications utilisateur sur transition (`approved` déclenche email à un superviseur, etc.).
- Frontend wizard de validation — change séparé `module-6b-workflows-frontend`.

## Key Decisions

### D1 — Séparation claire `WorkflowDefinition` vs `WorkflowInstance`

**Décision :** deux tables physiques. `workflow_definitions` est un **catalogue** (une ligne par type de workflow, ex: « Workflow de validation d'import » sur `target_type='import_session'`). `workflow_instances` est l'**état courant** d'un workflow appliqué à un objet précis (clé d'unicité métier `(organizationId, targetType, targetId)`).

**Alternatives écartées :**
- Une seule table fusionnée avec un champ « est-ce un template ? » → couplage forcé entre catalogue et runtime, requêtes plus lourdes.
- Pas de catalogue, le `targetType` dans `workflow_instances` est la seule source de vérité → impossible d'avoir plusieurs workflows distincts sur le même targetType (ex: workflow « validation rapide » vs « validation experte » sur `import_session`) — limitation future bloquante.

**Conséquence :** `startWorkflow` cherche d'abord `WorkflowDefinitionRepository.findActiveByTargetType(targetType)`. Si la définition n'existe pas ou est inactive, la transition lève `WORKFLOW_TRANSITION_INVALID`. Aucune création de définition par l'API publique en vague 1 — la définition `import_session` est seedée par migration.

### D2 — État courant matérialisé dans `workflow_instances.current_status`, transitions journalisées append-only dans `workflow_events`

**Décision :** la colonne `current_status` est la source de vérité pour l'état courant (requêtes O(1), pas de scan du journal). Chaque transition fait simultanément un `UPDATE workflow_instances SET current_status = :to` ET un `INSERT INTO workflow_events`. Le graphe d'états (`ALLOWED_TRANSITIONS` const) est appliqué côté service AVANT l'UPDATE — un saut illégal lève `WORKFLOW_TRANSITION_INVALID` sans toucher la DB.

**Alternatives écartées :**
- Event sourcing pur (reconstituer l'état en rejouant les events) → coût de lecture inacceptable pour `assertNotLocked` qui est sur le chemin chaud de l'upload Module 3.
- Pas de table d'events, seulement `current_status` → perte de l'historique (qui a approuvé, quand, avec quel commentaire) — non-négociable côté audit OHADA.

**Conséquence :** `current_status` et `workflow_events` peuvent diverger transitoirement si l'UPDATE et l'INSERT ne sont pas dans la même transaction. La méthode `transition` les enchaîne dans le même service call ; un wrap explicite `@Transactional` arrivera en vague 2 pour formaliser la garantie.

### D3 — `workflow_events` est append-only par contrat, pas par trigger DB

**Décision :** aucun endpoint `PATCH /workflows/events/:id` ni `DELETE`. Le repository expose seulement `record(input)` et `listByInstance(instanceId)`. Pas de trigger Postgres `BEFORE UPDATE/DELETE` (cohérent avec le choix du Module 7 — défense par API suffisante en MVP).

**Rationale :** la lecture passe toujours par `getHistory(instanceId, orgId)` qui filtre par `organization_id` du parent (tenant scope). Les events n'ont pas de `organization_id` direct — ils héritent du parent `workflow_instance` via `instance_id` FK. C'est suffisant tant que toute lecture transite par le service.

**Conséquence :** un opérateur DB peut techniquement modifier la table. Acceptable au stade MVP (cf. décision parallèle Module 7 D4). Trigger durci ajouté avant go-live multi-cabinet si l'audit IFRS l'exige.

### D4 — Invariant `locked` partagé via `WorkflowService.assertNotLocked` exporté

**Décision :** `WorkflowsModule` exporte `WorkflowService` (cf. `workflows.module.ts`). Les modules consommateurs (en vague 1 : `ImportsModule` ; en vague 2 : `JournalsModule` du Module 4) importent `WorkflowsModule` et appellent `assertNotLocked(orgId, 'import_session', sessionId)` avant toute mutation. La méthode lève `WORKFLOW_LOCKED` (mappée `409 CONFLICT`) si une instance existe avec `current_status = 'locked'`. Aucune instance OU instance dans un autre état → la méthode est un no-op (les workflows sont **opt-in** : tant qu'on n'a pas démarré, l'objet est libre).

**Alternatives écartées :**
- Foreign key + CHECK constraint depuis `import_sessions.workflow_locked_at` → couple les modules au niveau schéma, casse la généricité, force un ALTER TABLE à chaque nouveau target type.
- Event bus pubsub (`workflow.locked` → handlers dans chaque module) → cohérence éventuelle, complexité distribuée, mauvais ratio bénéfice/risque pour un MVP single-instance.

**Conséquence :** le contrat est **synchrone** et **explicite côté call-site**. Un développeur qui ajoute une mutation sans appeler `assertNotLocked` casse l'invariant — c'est rattrapé par des tests d'intégration ciblés (Module 3 valide déjà que l'upload sur session `locked` lève `WORKFLOW_LOCKED`). Le couplage cross-module est unidirectionnel : `imports → workflows`, jamais l'inverse.

## Risks

1. **Divergence `current_status` ↔ dernier event** — si l'UPDATE passe et l'INSERT échoue (ou inverse), la table d'instances ment par rapport au journal. Atténué en vague 1 par l'ordre fixe (UPDATE puis INSERT, tous deux dans le même flux service) ; durcissement vague 2 via wrapper `@Transactional` ou pattern outbox.
2. **Race condition sur double transition** — deux requêtes concurrentes `draft → in_review` sur la même instance peuvent toutes deux passer la validation graphe et faire un UPDATE successif. Atténué côté DB par l'idempotence du résultat (deux UPDATE vers le même état), mais le journal contiendra deux events de transition. À durcir avec un UPDATE conditionnel (`WHERE current_status = :from`) en vague 2.
3. **Pas de retention sur `workflow_events`** — table grossit linéairement avec l'activité. Acceptable MVP ; partitioning par année à poser avant le go-live multi-cabinet (cohérent avec la même recommandation Module 7).
4. **Generic engine peut paraître over-engineered en vague 1** — une seule cible (`import_session`), un seul graphe. Justification : le coût marginal de la généricité est faible (3 tables au lieu d'un champ `validation_status` sur `import_sessions`), et le bénéfice arrive dès Module 4 (réutilisation directe pour `journal_entry` sans nouveau schéma). Décision actée : on accepte le sur-design ponctuel pour ne pas refactorer dans 3 mois.
