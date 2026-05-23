# Guide de déploiement — ERP Compta OHADA

Guide opérationnel pour déployer la plateforme en production. Stack cible : **Supabase** (Postgres managé) + **Railway** (API NestJS) + **Vercel** (frontend Next.js, à venir).

Pour le contexte applicatif, voir [`apps/backend/README.md`](../apps/backend/README.md). Pour les tests e2e, voir [`docs/integration-tests.md`](./integration-tests.md).

---

## Vue d'ensemble

```
Browser  ──HTTPS──▶  Vercel (Next.js)  ──HTTPS──▶  Railway (NestJS API)  ──TLS──▶  Supabase (Postgres)
                                                            │
                                                            └──SMTP──▶  Postmark / Mailgun
```

Deux projets Supabase distincts sont utilisés :

- **prod** : `olpmrcifaupxphlrzuxc` (région `eu-west-3`, cluster `aws-1`) — déjà provisionné.
- **test e2e** : second projet free-tier à créer (cf. section 2).

---

## 1. Supabase production (déjà en place)

Statut : **fait**.

Récupérer le DSN à utiliser depuis le backend Railway :

1. Console Supabase → projet `olpmrcifaupxphlrzuxc`.
2. **Settings → Database → Connection string**.
3. Sélectionner l'onglet **Session pooler** (port `5432`), pas "Direct connection".
4. Copier le DSN, format attendu :

```
postgresql://postgres.olpmrcifaupxphlrzuxc:<password>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require
```

Pourquoi le pooler obligatoirement :

- La "Direct connection" Supabase est en **IPv6-only**. Les ISP ivoiriens (et Railway sur certains plans) ne routent pas IPv6 de façon fiable → connection refused intermittents.
- Le pooler Supavisor en `aws-1-eu-west-3.pooler.supabase.com` accepte IPv4.
- **Attention au circuit breaker** : 27 échecs d'auth consécutifs déclenchent un lockout de 10-15 min. La config TypeORM impose donc `retryAttempts <= 2` et `retryDelay >= 5000ms`. Ne pas augmenter sans raison.

---

## 2. Supabase test e2e (à faire)

Statut : **à faire par l'utilisateur**.

1. Console Supabase → **New project** → free-tier, même région `eu-west-3` si possible.
2. Récupérer le pooler DSN comme en section 1.
3. Le placer dans `apps/backend/.env.test` (jamais commit).
4. Voir [`docs/integration-tests.md`](./integration-tests.md) pour le détail du setup test.

---

## 3. Déployer le backend sur Railway

### 3.1 Pré-requis côté repo

- **Remote git public ou Railway-connecté** : actuellement aucun remote n'est configuré. À créer (GitHub recommandé) avant de continuer.
- Ajouter à la racine du monorepo un `railway.toml` :

```toml
[build]
builder = "NIXPACKS"
buildCommand = "pnpm install --frozen-lockfile && pnpm --filter backend build"

[deploy]
startCommand = "node apps/backend/dist/main.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
numReplicas = 1
```

Important : `numReplicas = 1` au minimum tant qu'on n'a pas une stratégie de migration distribuée (cf. section 3.4).

### 3.2 Setup du service Railway

1. Créer un compte sur [railway.app](https://railway.app).
2. **New Project → Deploy from GitHub repo** → sélectionner le repo.
3. **Settings → Source** : laisser **Root Directory** vide (le `railway.toml` à la racine gère le monorepo).
4. **Settings → Networking → Generate Domain** : Railway provisionne un domaine `*.up.railway.app`. Le noter pour la suite.
5. **Settings → Healthcheck** : `/health` (endpoint déjà implémenté).

### 3.3 Variables d'environnement

Onglet **Variables** du service Railway. Toutes les variables sont validées au boot par `src/config/env.validation.ts` — un manque fait crasher immédiatement.

| Variable              | Valeur (exemple)                                                              | Origine / commande                         |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| `NODE_ENV`            | `production`                                                                  | fixe                                       |
| `PORT`                | `${{PORT}}`                                                                   | injecté automatiquement par Railway        |
| `APP_BASE_URL`        | `https://app.example.com`                                                     | URL Vercel future (placeholder OK au boot) |
| `DATABASE_URL`        | `postgresql://postgres.olpmrcifaupxphlrzuxc:****@aws-1-eu-west-3.pooler...`   | section 1 (pooler, pas direct)             |
| `DB_SSL`              | `true`                                                                        | obligatoire pour Supabase                  |
| `JWT_SECRET`          | `f3a9...e2b1` (96 hex chars)                                                  | `openssl rand -hex 48`                     |
| `JWT_ACCESS_TTL`      | `15m`                                                                         | fixe                                       |
| `JWT_REFRESH_TTL`     | `7d`                                                                          | fixe                                       |
| `MFA_ENCRYPTION_KEY`  | `Xk2P...==` (base64, décode en 32 bytes exact)                                | `openssl rand -base64 32`                  |
| `SMTP_HOST`           | `smtp.postmarkapp.com`                                                        | dashboard Postmark                         |
| `SMTP_PORT`           | `587`                                                                         | fixe                                       |
| `SMTP_USER`           | `<server-token>`                                                              | dashboard Postmark                         |
| `SMTP_PASS`           | `<server-token>` (même valeur que SMTP_USER chez Postmark)                    | dashboard Postmark                         |
| `SMTP_FROM`           | `no-reply@votre-domaine.ci`                                                   | **doit matcher un sender vérifié**         |
| `EMAIL_DRY_RUN`       | `false`                                                                       | passer à `true` uniquement pour debug      |

Note : `main.ts` lit déjà `process.env.PORT ?? 3001` (ligne 88) — l'injection Railway fonctionne sans modification.

### 3.4 Premier déploiement

```bash
git push origin main
```

Railway détecte le push, build via Nixpacks (Node 20+ auto-détecté grâce à `engines.node` dans `package.json`), puis démarre.

Vérification :

```bash
curl https://<votre-app>.up.railway.app/health
# → {"status":"ok",...}
```

Suivre les logs en live depuis le dashboard Railway ou via CLI :

```bash
railway login
railway link
railway logs
```

### 3.5 Migrations en production

Deux approches, à choisir au début et s'y tenir.

**Option A — Pre-Deploy Command Railway (recommandé)**

Dans `railway.toml` :

```toml
[deploy]
preDeployCommand = "pnpm --filter backend migration:run"
```

Avantage : automatique à chaque deploy. Pré-requis : `numReplicas = 1` ou stratégie de lock (advisory lock Postgres) pour éviter la race condition entre deux instances qui boot en parallèle.

**Option B — Manuel via Railway CLI (plus prudent les premières fois)**

```bash
railway run pnpm --filter backend migration:run
```

À exécuter avant le déploiement qui contient la nouvelle migration.

**Interdit en production** :

```bash
# NE JAMAIS exécuter en prod — dataset de démo
pnpm --filter backend seed:dev
```

---

## 4. Frontend sur Vercel (à venir)

Statut : **à faire quand le frontend existera**.

1. `vercel --cwd apps/frontend` ou import du repo depuis le dashboard Vercel.
2. Framework Preset : **Next.js** (auto-détecté).
3. Root Directory : `apps/frontend`.
4. Variables d'env :
   - `NEXT_PUBLIC_API_URL=https://<votre-app>.up.railway.app`
5. Mettre à jour `APP_BASE_URL` côté Railway pour pointer vers le domaine Vercel final.

---

## 5. Pipeline de déploiement

| Branche      | Cible             | Comportement                                                |
| ------------ | ----------------- | ----------------------------------------------------------- |
| `main`       | prod              | Push auto → Railway prod + Vercel prod                      |
| `feature/*`  | preview           | Railway preview env (gratuit sur plan Hobby) + Vercel preview |

Les tests e2e tournent **localement** contre le Supabase de test (cf. [`docs/integration-tests.md`](./integration-tests.md)). Pas de e2e en CI au stade MVP — à industrialiser plus tard.

---

## 6. Coûts mensuels estimés

| Service          | Plan                       | Coût indicatif           |
| ---------------- | -------------------------- | ------------------------ |
| Railway          | Hobby (~500h compute)      | ~$5/mo                   |
| Supabase prod    | Free tier (500 MB, 50k MAU)| $0                       |
| Supabase test    | Free tier                  | $0                       |
| Vercel           | Hobby                      | $0                       |
| Postmark         | 100 emails/mo gratuits     | $0 → ~$15/mo après seuil |
| **Total MVP**    |                            | **~$5-20/mo**            |

Passer au plan Pro Supabase (~$25/mo) dès qu'on dépasse 500 MB ou qu'on veut des backups quotidiens.

---

## 7. Sécurité production

| Secret                 | Rotation conseillée | Procédure                                                                 |
| ---------------------- | ------------------- | ------------------------------------------------------------------------- |
| `JWT_SECRET`           | tous les 3 mois     | Régénérer + redeploy. **Invalide tous les tokens existants** (acceptable). |
| `MFA_ENCRYPTION_KEY`   | **JAMAIS sans plan de migration** | Changer cette clé rend tous les TOTP illisibles. Prévoir un script de rechiffrement avant rotation. |
| `DATABASE_URL` password| à la demande        | Console Supabase → Settings → Database → Reset password.                  |
| `SMTP_PASS`            | tous les 6 mois     | Régénérer le server token Postmark.                                       |

Règles non négociables :

- Ne jamais commit `.env`, `.env.production`, ni copier de clés Supabase dans le repo.
- HTTPS fourni automatiquement par Railway et Vercel — pas de config TLS manuelle.
- Activer `trust proxy` dans `main.ts` (cf. section "Manques détectés" en fin de doc) pour que `req.ip` soit correct derrière le load balancer Railway. Sans ça, les logs et le rate-limiting voient toujours l'IP du LB.
- Configurer CORS dans `main.ts` pour autoriser uniquement l'origin Vercel.

---

## 8. Dépannage

| Symptôme                                                | Cause probable                                           | Fix                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ECIRCUITBREAKER` / `MaxClientsInSessionMode`           | Supavisor lockout (27 échecs auth)                       | Attendre 10-15 min. Vérifier `DATABASE_URL` (password / username `postgres.<ref>`). |
| `ECONNREFUSED` ou `ETIMEDOUT` au boot                   | DSN "direct" (IPv6) au lieu du pooler                    | Reprendre le DSN Session pooler (section 1).                                        |
| `ssl: required` ou erreur TLS                           | `DB_SSL=false` ou absent                                 | Mettre `DB_SSL=true`.                                                               |
| `Migration failed: relation already exists`             | Deux instances Railway ont lancé `migration:run` ensemble | Forcer `numReplicas=1` + restart, ou migrer manuellement via `railway run`.        |
| `EnvValidationError: MFA_ENCRYPTION_KEY ...`            | Clé non base64 ou pas exactement 32 bytes décodés        | Régénérer : `openssl rand -base64 32`.                                              |
| `535 Authentication failed` (SMTP)                      | `SMTP_FROM` ne correspond pas à un sender vérifié        | Vérifier le sender chez Postmark/Mailgun.                                           |
| `EAUTH` Postmark                                        | `SMTP_USER` et `SMTP_PASS` doivent être le **server token**, pas l'API token compte | Récupérer le server token spécifique au serveur d'envoi. |
| CORS `Access-Control-Allow-Origin` manquant             | Pas de config CORS dans `main.ts`                        | Ajouter `app.enableCors({ origin: process.env.APP_BASE_URL, credentials: true })`.  |
| `req.ip` retourne toujours la même IP (celle du LB)     | `trust proxy` non configuré                              | `app.set('trust proxy', 1)` dans `main.ts`.                                         |
| Build Railway échoue sur `pnpm install`                 | Lockfile désync ou Node version trop basse               | Vérifier `engines.node >= 20`, regénérer `pnpm-lock.yaml` localement, commit, push. |

Logs structurés JSON via pino → exploitables tels quels par le viewer Railway (filter par `level`, `req.id`, etc.).

---

## Liens utiles

- [`apps/backend/README.md`](../apps/backend/README.md) — architecture backend, modules, conventions.
- [`apps/backend/.env.example`](../apps/backend/.env.example) — référence exhaustive des variables.
- [`docs/integration-tests.md`](./integration-tests.md) — setup tests e2e contre Supabase test.
- [`docs/error-codes.md`](./error-codes.md) — catalogue d'erreurs API.
- [Supabase pooler docs](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler)
- [Railway monorepo docs](https://docs.railway.app/guides/monorepo)
