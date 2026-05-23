## 1. Bootstrap backend NestJS

- [ ] 1.1 Initialiser le projet NestJS (`backend/`) avec TypeScript strict, ESLint, Prettier
- [ ] 1.2 Configurer la connexion PostgreSQL (TypeORM ou Prisma) avec variables d'env (`DATABASE_URL`)
- [ ] 1.3 Mettre en place la structure modulaire : `src/modules/{auth,organizations,rbac}/`, `src/common/`, `src/database/migrations/`
- [ ] 1.4 Ajouter les dépendances : `argon2`, `jsonwebtoken`, `otplib`, `qrcode`, `zod`/`class-validator`, `nodemailer`
- [ ] 1.5 Configurer le ConfigModule avec validation des env vars (`JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `SMTP_*`)
- [ ] 1.6 Mettre en place un intercepteur global qui normalise les réponses au format `{ data, error }`
- [ ] 1.7 Mettre en place un filtre d'exception global qui mappe les exceptions vers le catalogue d'erreurs (`AUTH_*`, `ORG_*`, `RBAC_*`)

## 2. Schéma de base de données

- [ ] 2.1 Créer la migration `organizations` (id, name, slug UNIQUE, type, timestamps, deleted_at)
- [ ] 2.2 Créer la migration `users` (id, email UNIQUE, password_hash, first_name, last_name, locale, is_active, timestamps, deleted_at)
- [ ] 2.3 Créer la migration `roles` (id, code UNIQUE, name, description, is_system) + seed des 6 rôles métier
- [ ] 2.4 Créer la migration `permissions` (id, code UNIQUE, description) + seed du catalogue de permissions
- [ ] 2.5 Créer la migration `role_permissions` (role_id, permission_id, PK composite) + seed des mappings par défaut
- [ ] 2.6 Créer la migration `memberships` (id, user_id, organization_id, role_id, status, timestamps, UNIQUE(user_id, organization_id))
- [ ] 2.7 Créer la migration `invitations` (id, organization_id, email, role_id, token_hash, status, invited_by, expires_at, accepted_at, timestamps)
- [ ] 2.8 Créer la migration `refresh_tokens` (id, user_id, organization_id NULL, token_hash, family_id UUID, used_at, expires_at, revoked_at, timestamps)
- [ ] 2.9 Créer la migration `mfa_configs` (id, user_id UNIQUE, secret_encrypted, enabled, activated_at, backup_codes_hashed[], timestamps)
- [ ] 2.10 Créer la migration `auth_events` (id, user_id NULL, organization_id NULL, event_type, ip_address INET, user_agent, metadata JSONB, created_at) + indexes
- [ ] 2.11 Ajouter les indexes composite `(organization_id, …)` sur memberships, invitations, refresh_tokens, auth_events

## 3. Service de hashing et chiffrement

- [ ] 3.1 Implémenter `PasswordService` avec `hash()` et `verify()` via argon2id (paramètres OWASP 2024)
- [ ] 3.2 Implémenter `EncryptionService` AES-256-GCM pour le secret MFA (clé depuis `MFA_ENCRYPTION_KEY`)
- [ ] 3.3 Tests unitaires : roundtrip hash/verify, roundtrip encrypt/decrypt, rejet d'une mauvaise clé

## 4. Service de tokens

- [ ] 4.1 Implémenter `JwtService` wrapper : `signAccessToken(payload)` (15 min), `verifyAccessToken(token)`
- [ ] 4.2 Implémenter `RefreshTokenService` : `issue(userId, orgId?, familyId?)`, `rotate(token)`, `revoke(token)`, `revokeFamily(familyId)`
- [ ] 4.3 Détection de réutilisation : si `used_at != null`, révoquer toute la famille et émettre `auth.refresh_token_reuse_detected`
- [ ] 4.4 Tests unitaires : rotation valide, réutilisation détectée, expiration, révocation

## 5. Module Auth (endpoints)

- [ ] 5.1 `POST /auth/signup` — création user, validation min 12 chars, hash argon2, émet `auth.signup`
- [ ] 5.2 `POST /auth/login` — vérif credentials, gère `mfa_required`, émet `auth.login_success` ou `auth.login_failed`
- [ ] 5.3 `POST /auth/select-organization` — vérif membership active, émet un nouveau JWT avec `org_id` + `role`
- [ ] 5.4 `POST /auth/refresh` — rotation refresh token + détection réutilisation
- [ ] 5.5 `POST /auth/logout` — révoque le refresh token, émet `auth.logout`
- [ ] 5.6 `POST /auth/mfa/setup` — génère secret base32, stocke chiffré (`enabled = false`), renvoie otpauth URI
- [ ] 5.7 `POST /auth/mfa/verify` — vérifie code TOTP, active MFA, génère et renvoie 10 backup codes (hashés)
- [ ] 5.8 `POST /auth/mfa/disable` — désactive MFA (exige code TOTP valide), émet `auth.mfa_disabled`
- [ ] 5.9 `POST /auth/invitations/accept` — accepte token, crée membership (et user si nouveau), invalide token

## 6. Module Organizations (endpoints)

- [ ] 6.1 `POST /organizations` — crée org + membership admin pour le créateur, slug dédupliqué
- [ ] 6.2 `GET /organizations` — liste les orgs où le user a une membership active
- [ ] 6.3 `PATCH /organizations/:id` — update name (admin only), slug immutable
- [ ] 6.4 `POST /organizations/:id/invitations` — envoie invitation (admin only), génère token, envoie email
- [ ] 6.5 `GET /organizations/:id/invitations` — liste invitations pending (admin only)
- [ ] 6.6 `DELETE /organizations/:id/invitations/:invitationId` — révoque invitation (admin only)
- [ ] 6.7 `GET /organizations/:id/members` — liste membres (tous rôles ayant `organizations.read`)
- [ ] 6.8 `PATCH /organizations/:id/members/:userId` — change rôle (admin only), refuse si dernier admin

## 7. Module RBAC (guards et décorateurs)

- [ ] 7.1 Implémenter `JwtAuthGuard` qui valide le token et injecte `currentUser` dans la request
- [ ] 7.2 Implémenter `TenantGuard` qui vérifie le claim `org_id`, charge la membership, échoue en 404 cross-tenant
- [ ] 7.3 Implémenter `PermissionsGuard` lu via `@RequirePermission('code')`, deny-by-default si aucune annotation
- [ ] 7.4 Implémenter `RolesGuard` lu via `@Roles('admin', ...)` pour les cas simples
- [ ] 7.5 Décorateurs `@CurrentUser()` et `@CurrentOrg()` pour récupérer le contexte dans les controllers
- [ ] 7.6 Émettre `auth.cross_tenant_attempt` quand le `TenantGuard` détecte un mismatch
- [ ] 7.7 Vérifier l'invariant "au moins un admin actif par organisation" dans le service de role/membership

## 8. Service email (invitations)

- [ ] 8.1 Implémenter `EmailService` avec `nodemailer` (SMTP configurable) et un mode `dry-run` en dev
- [ ] 8.2 Template d'email d'invitation (HTML + texte) avec le lien d'acceptation
- [ ] 8.3 Tests d'intégration : envoi en mode dry-run capture le contenu

## 9. Service Audit Events

- [ ] 9.1 Implémenter `AuthEventsService.record(eventType, { userId?, orgId?, ip, ua, metadata })`
- [ ] 9.2 Intercepteur qui extrait `ip` et `user-agent` de la request
- [ ] 9.3 S'assurer que tous les endpoints critiques appellent `record()` aux bons endroits
- [ ] 9.4 `GET /organizations/:id/auth-events` — lecture seule, admin only, paginé
- [ ] 9.5 Vérifier qu'aucun endpoint ne permet la modification ou suppression d'`auth_events`

## 10. Tests d'intégration de sécurité

- [ ] 10.1 Test "tenant isolation" : token org A → accès org B doit retourner 404
- [ ] 10.2 Test "permission deny by default" : endpoint sans `@RequirePermission` doit échouer
- [ ] 10.3 Test "last admin protection" : downgrade du dernier admin doit échouer en 409
- [ ] 10.4 Test "refresh token reuse" : réutilisation invalide toute la famille
- [ ] 10.5 Test "invitation single-use" : token déjà consommé doit retourner 409
- [ ] 10.6 Test "invitation expiration" : token > 7j retourne 410
- [ ] 10.7 Test "MFA activation flow" : setup → verify → enabled = true + backup codes
- [ ] 10.8 Test "error envelope" : toutes les erreurs respectent `{ data: null, error: { code, message } }`
- [ ] 10.9 Coverage globale ≥ 80 % sur les modules auth, organizations, rbac

## 11. Frontend Next.js (pages minimales)

- [ ] 11.1 Initialiser `frontend/` Next.js 15 avec TypeScript, Tailwind, shadcn/ui, Zustand, React Query, React Hook Form, Zod
- [ ] 11.2 Page `/signup` avec formulaire (email, password, firstName, lastName)
- [ ] 11.3 Page `/login` avec gestion `mfa_required` (étape OTP si vrai)
- [ ] 11.4 Page `/organizations` : sélecteur d'organisation après login (appelle `/auth/select-organization`)
- [ ] 11.5 Page `/accept-invitation?token=…` : flow d'acceptation (signup inline si user n'existe pas)
- [ ] 11.6 Page `/settings/mfa` : setup TOTP (QR code) + verify + affichage backup codes une seule fois
- [ ] 11.7 Store Zustand `useAuthStore` : tokens, currentUser, currentOrg, persistence localStorage
- [ ] 11.8 Middleware Next.js qui redirige vers `/login` si pas d'access token, vers `/organizations` si pas d'`org_id` dans le token

## 12. Documentation et seeds

- [ ] 12.1 Documenter le catalogue d'erreurs (`docs/error-codes.md`)
- [ ] 12.2 Documenter le modèle RBAC (rôles × permissions matrix) dans `docs/rbac.md`
- [ ] 12.3 README backend : démarrage local, variables d'env requises, commandes de migration et seed
- [ ] 12.4 Script de seed dev : crée une org de démo, un admin, et quelques membres avec rôles variés

## 13. Pre-merge checks

- [ ] 13.1 `pnpm test` backend passe avec coverage ≥ 80 %
- [ ] 13.2 `pnpm lint` et `pnpm typecheck` propres sur frontend et backend
- [ ] 13.3 Validation OpenSpec : `openspec status --change "module-1-auth-organizations"` montre `isComplete: true`
- [ ] 13.4 Revue par `security-reviewer` agent sur les modules auth/, rbac/, et le schéma DB
- [ ] 13.5 Revue par `code-reviewer` agent sur l'ensemble des modules livrés
