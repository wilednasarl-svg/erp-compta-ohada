## Why

Les cabinets comptables et PME de l'espace OHADA gèrent aujourd'hui leurs retraitements via Excel et Sage : aucune traçabilité, aucune séparation multi-clients sécurisée, aucun contrôle d'accès fiable, et aucun audit trail des modifications. Avant tout module métier (dossiers, imports, retraitements, reporting), la plateforme doit poser les fondations sécuritaires : un socle multi-tenant strict, un RBAC métier adapté aux cabinets (Admin, Expert-comptable, Chef de mission, Comptable, Auditeur, Client lecture seule), une base MFA, et un journal d'événements d'authentification. Sans cette couche, aucun module ultérieur ne peut être déployé en production chez un cabinet.

## What Changes

- Introduction d'un modèle de données multi-tenant : `Organization` (cabinet ou PME) comme racine d'isolation, `Membership` reliant `User` ↔ `Organization` avec un rôle, `Company` comme entité comptable détenue par une organisation.
- Authentification email + mot de passe avec hash bcrypt/argon2, tokens JWT (access + refresh) et rotation des refresh tokens.
- Système RBAC : permissions assignées aux rôles (jamais directement aux utilisateurs), 6 rôles métier prédéfinis, vérification systématique du tenant + rôle sur chaque endpoint protégé.
- Invitations par email avec token signé, expiration, acceptation créant un `Membership` dans l'organisation invitante.
- Base MFA (TOTP) : champs de structure (`secret`, `enabled`, `activated_at`, `backup_codes`) avec endpoints de setup/verify. L'enforcement UX complet viendra dans une change ultérieure.
- Audit trail des événements sensibles : login (succès/échec), logout, signup, création d'organisation, invitation envoyée/acceptée, changement de rôle, activation/désactivation MFA.
- Endpoints REST NestJS structurés sous `/auth/*` et `/organizations/*`, avec validation Zod/class-validator et réponses normalisées.

## Capabilities

### New Capabilities
- `auth`: authentification (signup, login, logout, refresh), gestion des sessions et tokens, base MFA, journal d'événements d'authentification.
- `organizations`: gestion des organisations multi-tenant, membres (memberships), invitations, et opérations CRUD sur les organisations.
- `rbac`: définition des rôles métier (Admin, Expert-comptable, Chef de mission, Comptable, Auditeur, Client lecture seule), permissions, et vérification d'autorisation par tenant.

### Modified Capabilities
<!-- Aucune capability existante - première change du projet -->

## Impact

- **Code backend (NestJS)** : nouveaux modules `auth/`, `organizations/`, `rbac/`, guards (`JwtAuthGuard`, `TenantGuard`, `RolesGuard`), décorateurs (`@Roles`, `@CurrentUser`, `@CurrentOrg`).
- **Base de données PostgreSQL** : 8 nouvelles tables (`organizations`, `users`, `memberships`, `roles`, `permissions`, `role_permissions`, `invitations`, `auth_events`) + seed des rôles et permissions par défaut.
- **Frontend (Next.js 15)** : pages `/login`, `/signup`, `/accept-invitation`, `/organizations` (sélecteur), middleware d'auth, store Zustand `useAuthStore`, hooks `useCurrentOrg`, `useCurrentUser`.
- **Dépendances** : `bcrypt`/`argon2`, `jsonwebtoken`, `otplib` (TOTP), `nodemailer` ou service email (Resend/SendGrid), `zod`.
- **Sécurité** : tous les modules métier ultérieurs (dossiers, imports, transformations, etc.) dépendent du `TenantGuard` et du `RolesGuard` mis en place ici.
- **Audit** : pose les bases du module 7 (Audit Trail Engine) — la table `auth_events` sera étendue plus tard en `audit_logs` générique.
