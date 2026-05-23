/**
 * Role catalog seeded by backend migration 0003. Mirrored here so the
 * frontend can render role labels + role pickers without a runtime
 * call to a (currently nonexistent) `GET /roles` endpoint. Drift from
 * the seed is a spec bug — keep this in sync with migration 0003.
 */
export const ROLE_CODES = [
  'admin',
  'expert_comptable',
  'chef_mission',
  'comptable',
  'auditeur',
  'client_readonly',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** French human-readable labels. Used by `<RoleBadge>` and role pickers. */
export const ROLE_LABELS: Record<RoleCode, string> = {
  admin: 'Administrateur',
  expert_comptable: 'Expert-comptable',
  chef_mission: 'Chef de mission',
  comptable: 'Comptable',
  auditeur: 'Auditeur',
  client_readonly: 'Client (lecture)',
};

export interface MemberView {
  readonly userId: string;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: string;
  readonly status: 'active' | 'suspended';
}

export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly roleCode: string;
  readonly status: 'pending' | 'accepted' | 'expired' | 'revoked';
  readonly expiresAt: string;
  readonly invitedBy: string;
}
