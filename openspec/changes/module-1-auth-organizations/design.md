## Context

Première change du projet ERP Compta. Aucun code applicatif n'existe encore — uniquement `openspec/` et le tracker `beads`. Le stack cible est NestJS (backend) + PostgreSQL + Next.js 15 (frontend). La plateforme est multi-tenant : un cabinet d'expertise comptable (= une `Organization`) gère plusieurs sociétés clientes (= `Company`), et un utilisateur (un collaborateur du cabinet) peut appartenir à plusieurs `Organization` (cas d'un expert qui travaille pour deux cabinets, ou d'un auditeur invité).

Toutes les décisions d'architecture (modèle multi-tenant, format de tokens, hash de mots de passe, structure RBAC) prises ici conditionnent les 13 modules suivants. Une erreur sur ce socle a un coût de migration élevé.

## Goals / Non-Goals

**Goals:**
- Définir un modèle multi-tenant strict : chaque ligne sensible porte un `organization_id`, et toute requête API passe par un `TenantGuard`.
- Permettre à un utilisateur d'appartenir à N organisations avec un rôle distinct par organisation (table de jointure `memberships`).
- Mettre en place un RBAC à 3 niveaux : `User` → `Membership(role)` → `Role` → `Permission`, jamais de permission directe sur l'utilisateur.
- Préparer la structure MFA (TOTP RFC 6238) côté DB et endpoints, même si l'UX d'enforcement est livrée plus tard.
- Journaliser les événements d'authentification dans une table dédiée `auth_events`, extensible vers un `audit_logs` générique au Module 7.
- Exposer une API REST cohérente sous `/auth/*` et `/organizations/*`, avec validation systématique et réponses normalisées `{ data, error }`.

**Non-Goals:**
- SSO entreprise (SAML/OIDC) — reporté à une change ultérieure.
- Enforcement complet du MFA (UX login en deux étapes, codes de récupération imprimables, rate limiting fin) — la structure de données est posée, l'UX viendra avec une change `auth-mfa-enforcement`.
- OAuth social (Google, Microsoft) — non requis en MVP.
- Magic links / passwordless — non requis en MVP.
- Audit trail générique métier (modifications d'écritures comptables, etc.) — c'est le scope du Module 7.
- Facturation, plans, quotas par organisation — sortira dans un module dédié.

## Decisions

### D1. Multi-tenancy via `organization_id` + `Membership`, pas de schéma PostgreSQL par tenant

**Choix** : tenancy logique avec une colonne `organization_id` sur toutes les tables métier, et une table `memberships(user_id, organization_id, role_id)` pour les appartenances.

**Alternatives considérées** :
- Un schéma PostgreSQL par tenant : rejeté → complexité opérationnelle (migrations × N schémas), coût pour les requêtes cross-org du cabinet (rapports portefeuille), incompatible avec un utilisateur qui appartient à plusieurs orgs.
- Une base PostgreSQL par tenant : rejeté → coût infra prohibitif sur le MVP, mêmes problèmes.

**Conséquences** :
- Un `TenantGuard` NestJS lira `organization_id` depuis le JWT (claim `org_id` sélectionné à la sélection d'organisation) et l'injectera dans toutes les requêtes.
- Index composite `(organization_id, …)` sur toutes les tables métier.
- Risque de fuite cross-tenant si une requête oublie le filtre → mitigé par une couche d'accès données obligatoire (repository) + tests automatisés de fuite.

### D2. Sélection d'organisation côté client après login, claim `org_id` dans l'access token

**Choix** : le login renvoie la liste des organisations de l'utilisateur. Le frontend appelle `POST /auth/select-organization` qui renvoie un nouvel access token contenant `org_id` + `role`. Tous les endpoints métier exigent un token avec `org_id`.

**Alternatives** :
- Passer `organization_id` en header sur chaque requête : rejeté → trop facile à oublier ou falsifier côté client, le JWT doit être la source de vérité.

### D3. Hash de mot de passe : argon2id

**Choix** : `argon2id` (lib `argon2` npm) avec paramètres OWASP 2024 (memory 19 MiB, iterations 2, parallelism 1).

**Alternatives** :
- bcrypt cost 12 : acceptable mais plus faible face aux GPU modernes.
- scrypt : moins répandu dans l'écosystème Node.

### D4. Tokens : JWT access court (15 min) + refresh token rotatif (7 jours) stocké en DB

**Choix** :
- Access token JWT signé HS256 (clé en env `JWT_SECRET`), durée 15 min, claims : `sub` (user_id), `org_id`, `role`, `mfa_verified`, `iat`, `exp`.
- Refresh token opaque (256 bits aléatoires) stocké hashé en DB (`refresh_tokens`), durée 7 jours, rotation à chaque usage (l'ancien est invalidé, un nouveau est émis).
- Détection de réutilisation : si un refresh token déjà consommé est rejoué → invalidation de toute la famille + event `refresh_token_reuse_detected` dans `auth_events`.

**Alternatives** :
- Refresh JWT auto-porteur : rejeté → impossible à révoquer avant expiration.

### D5. RBAC : 6 rôles métier seeded, permissions plates en base, vérification par décorateur

**Rôles** :
1. `admin` — administrateur de l'organisation, tous droits.
2. `expert_comptable` — expert-comptable, signature, validation finale.
3. `chef_mission` — chef de mission, supervise une mission/dossier client.
4. `comptable` — saisie et retraitement.
5. `auditeur` — lecture + commentaires + export audit, pas d'écriture sur les données.
6. `client_readonly` — utilisateur côté société cliente, lecture seule de ses propres dossiers.

**Format des permissions** : chaînes `domain.action` (ex : `accounting.write`, `organizations.invite`, `users.manage_roles`). Stockées dans `permissions`, liées via `role_permissions`.

**Vérification** : décorateur `@Roles('admin', 'expert_comptable')` + `@RequirePermission('accounting.write')` lus par un `RolesGuard` qui interroge le cache des permissions du rôle courant.

**Alternative** : ABAC (attribute-based) — rejeté pour le MVP, complexité non justifiée. On peut migrer vers ABAC plus tard sans casser le RBAC.

### D6. MFA TOTP (RFC 6238), structure prête mais enforcement reporté

**Choix** : table `mfa_configs(user_id, secret_encrypted, enabled, activated_at, backup_codes_hashed[])`. Endpoints `POST /auth/mfa/setup` (génère le secret + QR), `POST /auth/mfa/verify` (valide le code OTP), `POST /auth/mfa/disable`. Le secret est chiffré au repos (AES-256-GCM, clé `MFA_ENCRYPTION_KEY`).

Le login renvoie `mfa_required: true` si l'utilisateur a `mfa.enabled = true`. L'enforcement complet (forcer MFA pour les rôles `admin` et `expert_comptable`) est laissé à une change ultérieure.

### D7. Invitations par token signé + email, expiration 7 jours

**Choix** : `POST /organizations/:id/invitations` génère un token JWT court signé (HS256) avec `org_id`, `email`, `role_id`, `exp` (7j), stocké côté DB dans `invitations(token_hash, status, expires_at)`. Lien email `https://app/accept-invitation?token=…`. L'acceptation crée le `Membership`. Token à usage unique.

### D8. Réponses API normalisées et erreurs typées

Toutes les réponses : `{ data: T | null, error: { code: string, message: string, details?: object } | null }`. Codes d'erreur stables : `AUTH_INVALID_CREDENTIALS`, `AUTH_MFA_REQUIRED`, `ORG_NOT_FOUND`, `FORBIDDEN_ROLE`, `INVITATION_EXPIRED`, etc. Statuts HTTP cohérents (400/401/403/404/409/422).

### D9. Modèle de données (vue d'ensemble)

```
organizations(id PK, name, slug UNIQUE, type ENUM[firm,company], created_at, updated_at, deleted_at)

users(id PK, email UNIQUE, password_hash, first_name, last_name, locale, is_active, created_at, updated_at, deleted_at)

memberships(id PK, user_id FK→users, organization_id FK→organizations, role_id FK→roles, status ENUM[active,suspended], created_at, updated_at)
  UNIQUE(user_id, organization_id)
  INDEX(organization_id), INDEX(user_id)

roles(id PK, code UNIQUE, name, description, is_system BOOL)
  -- seed: admin, expert_comptable, chef_mission, comptable, auditeur, client_readonly

permissions(id PK, code UNIQUE, description)
  -- seed: organizations.read, organizations.update, organizations.invite, users.manage_roles, accounting.read, accounting.write, …

role_permissions(role_id FK, permission_id FK, PRIMARY KEY(role_id, permission_id))

invitations(id PK, organization_id FK, email, role_id FK, token_hash, status ENUM[pending,accepted,expired,revoked], invited_by FK→users, expires_at, accepted_at, created_at)
  INDEX(organization_id), INDEX(token_hash)

refresh_tokens(id PK, user_id FK, organization_id FK NULL, token_hash, family_id UUID, used_at, expires_at, revoked_at, created_at)
  INDEX(user_id), INDEX(family_id)

mfa_configs(id PK, user_id FK UNIQUE, secret_encrypted, enabled BOOL DEFAULT false, activated_at, backup_codes_hashed TEXT[], created_at, updated_at)

auth_events(id PK, user_id FK NULL, organization_id FK NULL, event_type, ip_address INET, user_agent, metadata JSONB, created_at)
  INDEX(user_id, created_at), INDEX(organization_id, created_at), INDEX(event_type, created_at)
```

## Risks / Trade-offs

- **[Fuite cross-tenant par requête oubliant `organization_id`]** → Mitigation : tous les accès DB passent par un repository qui exige `organization_id` en paramètre. Test d'intégration "tenant isolation" qui tente de lire les données de l'org B avec un token de l'org A — doit toujours renvoyer 404.
- **[Vol de refresh token]** → Mitigation : rotation systématique + détection de réutilisation (invalidation famille entière) + stockage hashé en DB.
- **[Mot de passe faible]** → Mitigation : politique côté API (min 12 caractères, vérif contre HIBP en option), pas de complexité forcée façon 2005 (NIST 800-63B).
- **[Invitation interceptée par email]** → Mitigation : token à usage unique, expiration 7j, scope strict (org + email + rôle), pas de privilèges au-delà de ce qui est encodé.
- **[Verrouillage admin si seul admin de l'org perd l'accès]** → Mitigation : règle "au moins un admin actif par organisation" — interdiction de retirer le dernier admin via API. Procédure de recovery hors-bande documentée séparément.
- **[Coût d'une migration ultérieure vers ABAC]** → Accepté : on isole la logique d'autorisation derrière le `RolesGuard` / `@RequirePermission`, ce qui permettra de remplacer l'implémentation sans toucher aux contrôleurs.
- **[JWT_SECRET partagé entre instances]** → Mitigation : variable d'env, rotation documentée, jamais committé.
- **[MFA structure posée mais non enforced]** → Risque accepté pour le MVP, mais documenté : aucun utilisateur production ne doit avoir le rôle `admin` avant l'enforcement MFA dans la change suivante.
