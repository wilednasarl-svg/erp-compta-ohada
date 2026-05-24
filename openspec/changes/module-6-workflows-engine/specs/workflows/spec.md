## ADDED Requirements

### Requirement: Generic workflow engine with explicit state machine

The system SHALL model every business validation cycle as a `WorkflowInstance` row in `workflow_instances`, linked to a `WorkflowDefinition` row in `workflow_definitions`, and journaled by `workflow_events`. Every instance MUST transition through a documented machine: `draft → in_review → approved → locked`. Reverse transitions `in_review → draft` and `approved → in_review` are permitted. The state `locked` MUST be terminal — no outgoing transition is allowed. Any transition not listed in `ALLOWED_TRANSITIONS` MUST be rejected with `422 WORKFLOW_TRANSITION_INVALID` before any database mutation.

In wave 1, the only supported `WorkflowTargetType` is `import_session`. The union is open by design — Module 4 (`journal_entry`) and Module 5 (`report`) will extend the union without schema changes.

#### Scenario: Starting a workflow on an import session
- **WHEN** an authenticated user with `workflows.write` calls `POST /workflows/start` with `{ targetType: "import_session", targetId: "<session-uuid>" }`
- **THEN** the system responds `201` with `{ id, currentStatus: "draft", ... }`, creates one `workflow_instances` row, inserts one `workflow_events` row with `fromStatus=null, toStatus="draft"`, and emits `workflows.started` to `audit_logs`

#### Scenario: Illegal transition is rejected
- **WHEN** a user attempts `POST /workflows/:instanceId/transition` with `{ toStatus: "approved" }` on an instance currently in `draft`
- **THEN** the system responds `422 WORKFLOW_TRANSITION_INVALID`, no `UPDATE` is issued on `workflow_instances`, and no `workflow_events` row is created

#### Scenario: Locked state is terminal
- **WHEN** any user attempts any transition (`toStatus` set to `draft`, `in_review`, or `approved`) on an instance currently in `locked`
- **THEN** the system responds `422 WORKFLOW_TRANSITION_INVALID` because `ALLOWED_TRANSITIONS[locked]` is the empty array

### Requirement: Starting a workflow is idempotent per (organization, targetType, targetId)

The system SHALL enforce that at most one `workflow_instance` exists for a given tuple `(organization_id, target_type, target_id)`. Calling `POST /workflows/start` a second time on an object that already has a started workflow MUST return the existing instance (HTTP `201` or `200`) rather than creating a duplicate. This makes the start operation safe to retry from clients without race-condition logic.

#### Scenario: Second start returns the existing instance
- **WHEN** a user calls `POST /workflows/start` twice with the same `targetType` and `targetId`
- **THEN** the second call returns the same `instance.id` as the first; the database contains exactly ONE row in `workflow_instances` for that tuple, and no additional starting event is recorded in `workflow_events`

#### Scenario: Same target across organizations is independent
- **WHEN** org A starts a workflow on `targetId=X` and org B starts a workflow on the same UUID `targetId=X`
- **THEN** two distinct `workflow_instances` rows exist (one per `organization_id`), each with its own state machine and history

### Requirement: Transitions are journaled append-only to workflow_events

Every successful transition MUST insert exactly one row in `workflow_events` with `from_status`, `to_status`, `actor_id` (the user who initiated, nullable for system jobs), `comment` (optional, max 2000 chars), and `occurred_at`. The first row of an instance is the synthetic start event with `from_status=null, to_status="draft"`. The HTTP surface MUST expose no `PATCH` or `DELETE` on workflow events — the only writer is `WorkflowService.transition` (and `startWorkflow` for the synthetic start row).

#### Scenario: History reflects the full transition log
- **WHEN** an instance progresses `draft → in_review → approved → locked` with comments at each step
- **THEN** `GET /workflows/:instanceId/history` returns four rows in chronological order: the synthetic start (`from=null, to=draft`), then `(draft, in_review)`, `(in_review, approved)`, `(approved, locked)`, each with its actor and comment

#### Scenario: There is no mutation endpoint for events
- **WHEN** any client (including admin) attempts `PATCH /workflows/events/:id` or `DELETE /workflows/events/:id`
- **THEN** the system responds `404` — the route does not exist; the only way to modify state is to record a NEW event via `transition`

### Requirement: locked is a shared invariant via assertNotLocked

`WorkflowService` MUST expose a method `assertNotLocked(organizationId, targetType, targetId)` that other modules import to guard mutations on potentially-locked objects. The method MUST throw `WORKFLOW_LOCKED` (mapped to HTTP `409 CONFLICT`) when a `workflow_instance` exists for the given tuple with `current_status='locked'`. The method MUST be a no-op (return without throwing) when no instance exists or when the instance is in any non-locked state — workflows are opt-in: an object without a started workflow is freely mutable.

The wave-1 caller is `ImportSessionService` (upload/parse/commit). The wave-2 caller is `JournalsService` (Module 4) on every entry mutation. The coupling is unidirectional: consumer modules import `WorkflowsModule`; `WorkflowsModule` MUST NOT depend on any business module.

#### Scenario: Upload on a locked import session is blocked
- **WHEN** an `import_session` has its workflow in `locked` and a user attempts `POST /organizations/:id/imports/sessions/:sessionId/files`
- **THEN** the system responds `409 WORKFLOW_LOCKED`, no `import_files` row is created, and no file is written to disk

#### Scenario: Mutation on an object without a workflow proceeds
- **WHEN** an `import_session` has no `workflow_instance` started AND a user uploads a file
- **THEN** `assertNotLocked` is a no-op, the upload proceeds normally; the absence of a workflow is NOT a blocker

#### Scenario: Mutation while in_review is allowed
- **WHEN** a workflow is in `in_review` (not yet `locked`) and a user attempts a mutation gated by `assertNotLocked`
- **THEN** the guard passes silently; only the terminal `locked` state blocks; gating mutations during `in_review` is the responsibility of the consumer module (out of scope for `assertNotLocked`)

### Requirement: Workflows are tenant-scoped and RBAC-gated

`POST /workflows/start`, `POST /workflows/:instanceId/transition`, and `GET /workflows/:instanceId/history` MUST run under `JwtAuthGuard + TenantGuard + PermissionsGuard`. Every read or write MUST filter on `organization_id = currentOrg.id` derived from the JWT — never from a request payload. RBAC matrix:

| Permission | admin | expert_comptable | chef_mission | comptable | auditeur | client_readonly |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `workflows.read` | yes | yes | yes | yes | yes | yes |
| `workflows.write` | yes | yes | yes | yes | | |
| `workflows.approve` | yes | yes | yes | | | |

In wave 1, `workflows.write` is the controller-level guard for both start and transition. The fine-grained `workflows.approve` check (required for transitions to `approved` and `locked`) is documented in `TRANSITION_PERMISSION` but not yet enforced at the instance level — the state-machine graph already rejects illegal jumps. Per-transition permission enforcement arrives in wave 2 with `MembershipRepository` injection.

#### Scenario: Cross-tenant transition returns 404
- **WHEN** a user with `org_id = A` calls `POST /workflows/<instanceIdOwnedByOrgB>/transition`
- **THEN** the system responds `404 WORKFLOW_INSTANCE_NOT_FOUND` (never `403`) and no audit row for `workflows.transition` is emitted on org A

#### Scenario: Comptable can submit but workflow graph protects approval
- **WHEN** a `comptable` calls `POST /workflows/:instanceId/transition` with `{ toStatus: "in_review" }` on a `draft` instance
- **THEN** the request succeeds — `comptable` has `workflows.write` and the transition is in `ALLOWED_TRANSITIONS["draft"]`

#### Scenario: Auditeur cannot write
- **WHEN** an `auditeur` calls `POST /workflows/start` or `POST /workflows/:instanceId/transition`
- **THEN** the system responds `403 FORBIDDEN_PERMISSION` because the role lacks `workflows.write`
