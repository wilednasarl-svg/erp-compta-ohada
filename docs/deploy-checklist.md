# Checklist de déploiement — exécution

Compagnon actionnable de [`docs/deployment.md`](./deployment.md). À cocher en
séquence. Ce qui est **automatisé par le repo** est déjà fait ; ce qui est
**à faire par toi** demande un compte Railway/Vercel/Supabase/Postmark + un
copier-coller dans les dashboards.

> **Ne commit jamais ce fichier rempli avec de vraies valeurs.** Les secrets
> ci-dessous sont fournis à titre d'exemple — régénère-les avant de
> déployer (cf. § Secrets).

---

## Pré-flight (vérifié, ✅ rien à faire)

- [x] `railway.toml` à la racine avec `healthcheckPath=/health`.
- [x] Endpoint `GET /health` (liveness, no DB) + `GET /health/db` (readiness).
- [x] `app.set('trust proxy', 1)` + `app.enableCors(...)` câblés dans `apps/backend/src/main.ts`.
- [x] `engines.node >= 20` dans `apps/backend/package.json` et `apps/frontend/package.json`.
- [x] `pnpm-lock.yaml` à la racine, lockfile unique, frozen.
- [x] Frontend prêt — 10 routes statiques, env var `NEXT_PUBLIC_API_BASE_URL`.
- [x] Git remote configuré : `origin → github.com/wilednasarl-svg/erp-compta-ohada.git`.

---

## Secrets à générer (à FAIRE — ne pas réutiliser tes secrets de dev)

```powershell
# JWT_SECRET (96 hex chars)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# MFA_ENCRYPTION_KEY (base64, décode en 32 bytes exact)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Garde-les dans un password manager — tu vas les coller dans Railway et NULLE
PART ailleurs.

> **`MFA_ENCRYPTION_KEY` est immuable** une fois en prod avec des utilisateurs
> MFA actifs : la changer rend tous les TOTP illisibles. Plan de migration
> requis avant rotation (cf. `docs/deployment.md` § 7).

---

## Étape 1 — Pousser sur GitHub

- [ ] `git push origin master` (ou `main`, selon ta branche).
- [ ] Vérifier que le dernier commit visible sur GitHub correspond à ton local.

---

## Étape 2 — Backend sur Railway

### 2.1 Créer le service

- [ ] Aller sur [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
- [ ] Sélectionner `wilednasarl-svg/erp-compta-ohada`.
- [ ] **Settings → Source → Root Directory** : laisser **vide** (le `railway.toml` racine pilote le build).
- [ ] **Settings → Networking → Generate Domain** → noter l'URL `*.up.railway.app`.

### 2.2 Variables d'environnement

Onglet **Variables** du service. Toutes obligatoires (env.validation crash sinon).

- [ ] `NODE_ENV = production`
- [ ] `APP_BASE_URL = https://placeholder.local` (sera remplacé après Vercel, étape 4)
- [ ] `DATABASE_URL = postgresql://postgres.olpmrcifaupxphlrzuxc:<password>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require`
      → récupérer le password depuis **Console Supabase → Settings → Database → Connection string → Session pooler**.
- [ ] `DB_SSL = true`
- [ ] `JWT_SECRET = <ta valeur générée>`
- [ ] `JWT_ACCESS_TTL = 15m`
- [ ] `JWT_REFRESH_TTL = 7d`
- [ ] `MFA_ENCRYPTION_KEY = <ta valeur générée>`
- [ ] `SMTP_HOST = smtp.postmarkapp.com` (ou ton fournisseur)
- [ ] `SMTP_PORT = 587`
- [ ] `SMTP_USER = <server-token>`
- [ ] `SMTP_PASS = <server-token>` (chez Postmark = même valeur que SMTP_USER)
- [ ] `SMTP_FROM = no-reply@<ton-domaine-vérifié>`
- [ ] `EMAIL_DRY_RUN = false`

Railway injecte `PORT` automatiquement — ne PAS le définir.

### 2.3 Migrations + premier deploy

- [ ] Railway déploie au premier push. Suivre les logs (icône **Logs** du service).
- [ ] Une fois vert, exécuter les migrations :
      ```powershell
      pnpm dlx @railway/cli@latest login
      pnpm dlx @railway/cli@latest link
      pnpm dlx @railway/cli@latest run pnpm --filter backend migration:run
      ```
- [ ] **Smoke test** :
      ```powershell
      curl https://<votre-app>.up.railway.app/health
      # → {"data":{"ok":true},"error":null}
      ```

### 2.4 Pre-deploy command (optionnel — à activer une fois confiant)

- [ ] Editer `railway.toml` → ajouter `preDeployCommand = "pnpm --filter backend migration:run"` sous `[deploy]`.
- [ ] Commit + push. Les migrations tournent automatiquement à chaque deploy. Pré-requis : `numReplicas = 1` (déjà le cas).

---

## Étape 3 — Frontend sur Vercel

- [ ] [vercel.com](https://vercel.com) → **Add New → Project** → importer le même repo.
- [ ] **Root Directory** : `apps/frontend`.
- [ ] **Framework Preset** : Next.js (auto-détecté).
- [ ] **Environment Variables** :
      - `NEXT_PUBLIC_API_BASE_URL = https://<votre-app>.up.railway.app` (URL Railway de l'étape 2).
- [ ] **Deploy**.
- [ ] Une fois vert, noter l'URL Vercel (ex. `https://erp-compta.vercel.app`).

---

## Étape 4 — Refermer la boucle CORS

- [ ] Retour Railway → service backend → **Variables** → remplacer `APP_BASE_URL` :
      ```
      APP_BASE_URL = https://erp-compta.vercel.app
      ```
- [ ] Railway redeploye automatiquement (~30 s).
- [ ] **Smoke test end-to-end** : ouvrir l'URL Vercel, faire un signup avec un email réel, login, créer une org. Network tab du browser : aucune erreur CORS.

---

## Étape 5 — Vérifications post-déploiement

- [ ] **Liveness** : `curl https://<railway>/health` → 200 `{ok:true}`.
- [ ] **Readiness DB** : `curl https://<railway>/health/db` → 200 `{ok:true}`.
- [ ] **Swagger** : `https://<railway>/api` doit afficher la doc OpenAPI.
- [ ] **CORS** : depuis le frontend Vercel, signup → login → /organizations marche sans erreur dans la console browser.
- [ ] **Audit** : se connecter en admin → `/invitations` → envoyer une invitation à toi-même → vérifier l'email reçu (Postmark dashboard → Activity).
- [ ] **MFA** : `/settings/mfa` → setup → scanner avec Google Authenticator → verify → backup codes affichés.
- [ ] **Logs structurés** : Railway viewer → vérifier que les logs sont au format JSON (pino).

---

## Si ça ne marche pas

Reprendre le tableau de dépannage en bas de [`docs/deployment.md`](./deployment.md) § 8.

Top 3 des erreurs au premier deploy :

1. **`ECIRCUITBREAKER`** — tu as tapé un mauvais password Supabase 27 fois. Attendre 15 min, vérifier le DSN.
2. **Healthcheck timeout** — Railway pingue `/health`, vérifier que la route répond (devrait être OK si tu n'as rien touché à `health.controller.ts`).
3. **CORS bloqué** — `APP_BASE_URL` ne matche pas l'origin Vercel. Recopier l'URL EXACTE (avec `https://`, sans trailing slash).
