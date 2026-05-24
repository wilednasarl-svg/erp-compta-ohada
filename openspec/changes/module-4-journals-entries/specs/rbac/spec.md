## ADDED Requirements

### Requirement: Permission catalog includes `journals.*` codes

The RBAC permission catalog SHALL include four additional permission codes — `journals.read`, `journals.write`, `journals.validate`, `journals.close_period` — seeded via migration `0025_add_journals_permissions`. The matrix:

| Role | `journals.read` | `journals.write` | `journals.validate` | `journals.close_period` |
|------|:---:|:---:|:---:|:---:|
| `admin` | ✓ | ✓ | ✓ | ✓ |
| `expert_comptable` | ✓ | ✓ | ✓ | ✓ |
| `chef_mission` | ✓ | ✓ | ✓ | ✗ |
| `comptable` | ✓ | ✓ | ✗ | ✗ |
| `auditeur` | ✓ | ✗ | ✗ | ✗ |
| `client_readonly` | ✓ | ✗ | ✗ | ✗ |

Migration MUST be idempotent (`ON CONFLICT DO NOTHING`).

**Rationale**:
- `journals.read` for everyone with org access (comptable needs to consult the grand-livre to know if a fournisseur is already paid).
- `journals.write` excludes auditeur and client (they only consult).
- `journals.validate` excludes `comptable` (saisie) — validation is the moment an entry becomes immutable; that decision belongs to someone with authority. The comptable saves a draft; the chef de mission or expert-comptable validates.
- `journals.close_period` reserved to admin + expert-comptable only — closing a period is the equivalent of "locking the books for that month", a governance action.

#### Scenario: Comptable can save drafts but not validate
- **WHEN** a `comptable` POSTs `/entries` (draft) — succeeds
- **WHEN** the same user POSTs `/entries/:id/validate`
- **THEN** the system responds `403` with `{ error: { code: "FORBIDDEN_PERMISSION", details: { required: "journals.validate" } } }`

#### Scenario: Only admin and expert-comptable can close a period
- **WHEN** a `chef_mission` POSTs `/accounting-periods/:id/close`
- **THEN** the system responds `403` with `{ error: { code: "FORBIDDEN_PERMISSION", details: { required: "journals.close_period" } } }`
