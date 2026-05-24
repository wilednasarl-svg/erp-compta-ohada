## Context

Le moteur de règles est la **couche d'automatisation** qui s'intercale entre Module 3 (staging des lignes brutes) et Module 4 (transformations comptables). Sans lui, chaque retraitement récurrent (reclassement comptable, attribution analytique, taggage) doit être refait à la main par le comptable. Avec lui, une intention métier — « toute charge bancaire `62xx` partir sur le centre `ADMIN` » — devient un artefact persistant, simulable, réutilisable, versionnable et auditable.

Le design ci-dessous arbitre entre **expressivité du DSL** (assez riche pour couvrir les cas réels d'un cabinet OHADA) et **simplicité d'évaluation** (pas de moteur d'expression dynamique côté serveur — pas de `eval`, pas de templating). Le choix d'une union discriminée TypeScript stockée en JSONB couvre 100% des cas observés en vague 1 tout en restant extensible sans migration SQL.

## Goals / Non-Goals

**Goals (vague 1, ce change) :**
- CRUD règles avec validation stricte des types de conditions et d'actions (whitelist serveur).
- Évaluation pure d'une règle sur une entry (`evaluateRuleOnEntry`) sans side-effect — réutilisable en simulation et en apply.
- Mode `simulation` : retourne le plan d'exécution (matches + actions résolues) sans créer de transformation.
- Mode `apply` : crée les transformations via `TransformationService` (Module 4) — chaque action devient une `entry_transformation` traçable.
- Journal `rule_executions` append-only avec snapshot des matches et des IDs de transformations créées.
- Permissions RBAC séparées `simulate` vs `apply` pour permettre la délégation graduée (comptable teste, expert valide et applique).

**Non-Goals (sortent en vague 2) :**
- Trigger automatique d'une règle à l'ingestion (event-driven). Vague 1 = exécution manuelle uniquement via `POST /apply`.
- Règles dynamiques (`if condition then create_rule(...)`) ou récursives.
- Mapping ML / suggestion automatique de règles basée sur l'historique des transformations manuelles.
- Annulation en masse (`undo apply`) — possible aujourd'hui en cancellant les transformations une à une via Module 4, mais pas de bouton « rollback execution X » global.
- Frontend wizard de création de règle — change séparé `module-5b-rules-frontend`.

## Key Decisions

### D1 — Séparation `RulesService` (CRUD) et `RuleEngineService` (execution)

**Décision :** deux services distincts injectés indépendamment. `RulesService` porte create/update/list/get + l'historique d'exécution. `RuleEngineService` porte `evaluateRuleOnEntry` (pur), `simulateRules`, `applyRules`. Le controller injecte les deux et route chaque endpoint vers le bon service.

**Alternatives écartées :**
- Service unique `RulesService` avec tout : 600+ lignes, mélange de préoccupations (validation de DSL + fetch d'entries + délégation transformations), test unitaires fragiles.
- Trois services (CRUD / engine / executions) : sur-découpé pour la vague 1, complique l'injection.

**Conséquence :** la table `rule_executions` est écrite par `RuleEngineService.persistExecution` et lue par `RulesService.getExecutionHistory` — les deux services partagent le même `RuleExecutionRepository`. Aucune duplication.

### D2 — Conditions et actions = union discriminée TypeScript stockée en JSONB

**Décision :** `RuleCondition` et `RuleAction` sont des `type` unions discriminées sur le champ `type` (`'account_prefix' | 'account_in' | …`). Stockage en JSONB sans schéma figé côté DB. Validation runtime via whitelist de `type` au moment du `createRule` / `updateRule`.

**Alternatives écartées :**
- ENUM SQL pour les `type` + colonnes typées pour chaque opérande : explosion combinatoire de colonnes nullables, chaque nouvel opérateur impose une migration.
- DSL string (`"account LIKE '62%' AND journal IN ('BQ')"`) parsé côté serveur : ouvre la porte à un mini-langage à entretenir, vecteur d'injection si jamais évalué dynamiquement.
- JSON Schema validation côté DB (`CHECK jsonb_matches_schema(...)`) : Postgres ne valide pas nativement les JSON Schemas, et l'extension `pg_jsonschema` n'est pas garantie sur Supabase managed.

**Conséquence :** la validation runtime du DSL vit dans `RulesService.validateRuleDefinition` — une seule source de vérité, testable unitairement. Un `type` inconnu retourne `422 RULE_INVALID_CONDITION` ou `422 RULE_INVALID_ACTION`. L'ajout d'un nouvel opérateur (ex. `entity_in_list`) est : 1 ligne de type + 1 ligne dans le whitelist + 1 case dans `matchesCondition` — pas de migration SQL.

### D3 — Simulation vs apply : deux endpoints séparés, même évaluation sous-jacente

**Décision :** `simulateRules` et `applyRules` partagent **strictement** le même algorithme d'évaluation (`evaluateRuleOnEntry`) et la même requête de fetch (`fetchEntries`). La seule différence est : en simulation, aucun appel à `TransformationService` ; en apply, chaque action devient un `transformations.reclassifyEntry`. Les deux modes persistent un `rule_executions` row.

**Rationale :**
- L'utilisateur DOIT pouvoir prévisualiser **exactement** ce que `apply` ferait. Une divergence entre les deux modes serait un piège majeur en production (l'expert-comptable signe un plan, l'apply produit autre chose).
- La persistance d'une exécution même en simulation permet d'auditer « qui a testé quoi » et de comparer une simulation passée avec un apply ultérieur.

**Conséquence sécurité :** la permission `rules.simulate` est délibérément moins restrictive que `rules.apply`. Un `comptable` peut simuler n'importe quelle règle (pas de risque — aucun side-effect comptable), mais ne peut pas appliquer (réservé aux rôles seniors). L'auditeur peut lire les exécutions passées (`rules.read`) sans pouvoir simuler ni appliquer.

### D4 — Apply n'est PAS transactionnel — best-effort par entry avec error report

**Décision :** lorsque `applyRules` traite N entries, une erreur sur l'entry K **n'annule pas** les transformations déjà créées pour les entries 1..K-1. Le moteur loggue l'erreur, continue avec les entries restantes, et retourne un `RuleExecutionResult` dont le champ `error` porte le premier message d'erreur rencontré. Le `applied_count` reflète le nombre réel de transformations créées.

**Rationale :**
- Une transaction unique sur potentiellement des milliers de transformations est un anti-pattern Postgres (lock contention, rollback coûteux, risque de timeout).
- L'invariant d'immuabilité des sources reste intact : les entries sources ne sont jamais modifiées, donc une exécution partielle ne corrompt aucune donnée comptable — au pire, certaines entries n'ont pas reçu la transformation attendue, et l'utilisateur peut relancer `apply` qui reclassera les entries non encore transformées.
- L'audit trail capture exactement ce qui a été fait : `transformation_ids` liste les UUID des transformations effectivement créées, `matches_snapshot` capture tout le plan, `error` porte le détail.

**Alternative écartée :** transaction unique encadrant le boucle d'apply → améliore la cohérence atomique au prix d'un coût opérationnel élevé et d'un risque de deadlock sur les inserts dans `entry_transformations`. À reconsidérer en vague 2 si le besoin émerge.

### D5 — Idempotence partielle : pas de garde-fou contre double-apply

**Décision :** la vague 1 **n'empêche pas** d'appliquer deux fois la même règle sur le même périmètre. Le second apply créera N nouvelles transformations en doublon des précédentes. Le compteur `applied_count` du second `rule_executions` reflètera la vérité (« 50 transformations créées »), même si elles font doublon avec les 50 précédentes.

**Rationale :**
- Détecter le doublon nécessiterait soit un index unique sur `(source_entry_id, rule_id, action_type)` côté `entry_transformations` — couplage trop fort entre les deux modules ; soit une logique côté `RuleEngineService` qui interroge l'historique avant chaque apply — complexité significative pour un cas que l'UI peut prévenir en vague 1.
- L'utilisateur a une preview claire via `simulate` immédiatement avant `apply` — la double application accidentelle est dans la responsabilité de l'UI (vague 2 : confirmation modale + désactivation du bouton après apply réussi).
- Le risque comptable est limité : les transformations en doublon sont visibles dans l'historique `transformations/entries/:entryId/history` et peuvent être cancellées une par une.

**Mitigation actuelle :** chaque transformation porte `notes: "Règle automatique: <ruleName>"` ce qui rend les doublons identifiables visuellement à l'inspection.

### D6 — Permissions RBAC : `simulate` ouvert, `apply` restrictif

**Décision :** matrice RBAC pour les 4 nouvelles permissions :

|  | admin | expert_comptable | chef_mission | comptable | auditeur | client_readonly |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `rules.read` | OUI | OUI | OUI | OUI | OUI | OUI |
| `rules.write` | OUI | OUI | OUI |  |  |  |
| `rules.simulate` | OUI | OUI | OUI | OUI |  |  |
| `rules.apply` | OUI | OUI | OUI |  |  |  |

**Rationale :** un `comptable` doit pouvoir tester ses propres règles candidates (simuler), mais l'application en production reste un acte d'autorité comptable senior. `auditeur` lit l'historique (`rules.read`) pour comprendre ce qui a été automatisé, sans pouvoir ni écrire ni exécuter. `client_readonly` voit les règles définies pour son dossier mais rien d'autre.

## Risks

1. **DSL trop limitant pour les cas tordus** — la combinaison `AND` implicite entre conditions ne permet pas `OR` ni `NOT` dans une seule règle. Mitigation : créer deux règles séparées avec la même action. À évaluer en vague 2 si le besoin émerge (probablement via un wrapper `{ type: 'or', conditions: [...] }`).
2. **Performance sur gros volumes** — `fetchEntries` retourne tout le périmètre en mémoire avant filtre. Acceptable pour des sessions d'import de quelques milliers de lignes ; à instrumenter en vague 2 pour des volumes > 50 000 lignes (passer en streaming ou en batch).
3. **Couplage avec TransformationService** — chaque type d'action est traduit en un appel à `reclassifyEntry`. Si le Module 4 change la signature, le moteur casse. Mitigation : tests d'intégration cross-module + types partagés. À long terme, considérer une couche d'adaptation explicite.
4. **Pas de versionning des règles** — modifier une règle existante ne préserve pas la version qui a produit les transformations passées. Mitigation : le `matchesSnapshot` de `rule_executions` capture les actions effectivement appliquées au moment de l'exécution — l'historique reste fidèle même si la règle est modifiée plus tard. Versionning explicite à évaluer en vague 2.
