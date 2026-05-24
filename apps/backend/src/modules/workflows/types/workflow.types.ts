/**
 * Workflow state machine for Module 6 — vague 1.
 *
 * Graph (no return from `locked`):
 *   draft → in_review → approved → locked
 *
 * `locked` is a strong terminal state: certain business operations
 * (e.g. re-uploading files on a committed import session) must check
 * `WorkflowService.assertNotLocked(targetType, targetId)` before
 * proceeding.
 */
export type WorkflowStatus = 'draft' | 'in_review' | 'approved' | 'locked';

/**
 * Wave 1 covers `import_session` only.  Extend this union (and add a
 * migration for any new FK constraint) when further target types arrive.
 */
export type WorkflowTargetType = 'import_session';

/**
 * Static transition graph.  Lookup: `ALLOWED_TRANSITIONS[from]` gives
 * the set of valid `to` states.
 */
export const ALLOWED_TRANSITIONS: Record<WorkflowStatus, ReadonlyArray<WorkflowStatus>> = {
  draft: ['in_review'],
  in_review: ['approved', 'draft'],
  approved: ['locked', 'in_review'],
  locked: [],
};

/**
 * Minimum RBAC permission required to apply a specific transition.
 * `workflows.approve` guards the `approved` and `locked` transitions;
 * `workflows.write` is sufficient for the others.
 */
export const TRANSITION_PERMISSION: Record<WorkflowStatus, string> = {
  draft: 'workflows.write',
  in_review: 'workflows.write',
  approved: 'workflows.approve',
  locked: 'workflows.approve',
};
