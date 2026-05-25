/**
 * Module 14 — Journal entry workflow & electronic signatures.
 *
 * Sémantique des rôles (mappés sur les permissions RBAC) :
 *   - `chef_mission`     ↔ permission `journals.review`
 *   - `expert_comptable` ↔ permission `journals.sign`
 *
 * Un signataire ne peut apposer qu'une seule signature par entry par rôle.
 * La signature finale `expert_comptable` déclenche `EntriesService.validate`
 * (entry status → 'validated') et lock le workflow Module 6.
 */
export type SignerRole = 'chef_mission' | 'expert_comptable';

export const SIGNER_ROLES: ReadonlyArray<SignerRole> = ['chef_mission', 'expert_comptable'];

export function isSignerRole(value: unknown): value is SignerRole {
  return typeof value === 'string' && (SIGNER_ROLES as ReadonlyArray<string>).includes(value);
}
