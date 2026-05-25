# Types API auto-générés depuis l'OpenAPI backend

Le frontend ne déclare PAS manuellement les shapes de réponse du backend.
Les types TypeScript sont générés depuis la spec OpenAPI 3 exposée par
NestJS sur `/docs-json`, via [`openapi-typescript`](https://www.npmjs.com/package/openapi-typescript).

## Fichiers

- `src/lib/api/openapi.types.ts` — **généré, versionné**. Ne pas éditer
  à la main. Contient `paths` (toutes les routes) et `components.schemas`
  (toutes les réponses DTO).
- `src/lib/api/types.ts` — **maintenu à la main**. Alias pratiques par
  domaine métier (TVA, et bientôt les autres modules). Importer
  systématiquement depuis ce fichier dans les pages / composants :

  ```ts
  import type { TvaDeclaration, ListTvaCodes } from '@/lib/api/types';
  ```

## Régénérer les types

### Pré-requis

- Le backend doit tourner localement (et exposer `/docs-json`).
- Par défaut le backend écoute sur `http://localhost:3001` (cf.
  `apps/backend/src/main.ts`, `PORT` env).

### Procédure

```bash
# 1. Démarrer le backend (dans un terminal séparé, à laisser tourner)
pnpm --filter backend start:dev

# 2. Attendre que /docs-json réponde 200
curl -I http://localhost:3001/docs-json

# 3. Régénérer le fichier openapi.types.ts
pnpm --filter frontend generate:api-types

# 4. Étendre src/lib/api/types.ts avec les nouveaux alias si besoin

# 5. Commit les deux fichiers (openapi.types.ts + types.ts)
git add apps/frontend/src/lib/api/openapi.types.ts apps/frontend/src/lib/api/types.ts
```

## Quand régénérer ?

À chaque changement de contrat backend :

- Nouveau DTO de réponse (`*.response.ts`).
- Nouveau champ `@ApiProperty()` sur un DTO existant.
- Nouvelle route `@ApiOkResponse({ type: ... })`.
- Modification d'enum ou de nullabilité côté backend.

## Pourquoi committer le fichier généré ?

- Le typecheck CI doit pouvoir tourner sans démarrer le backend.
- Le diff Git rend visible tout changement de contrat dans la PR backend.
- Recommandation : un job CI (à venir) regénérera les types et fail si
  diff vs commit, garantissant que `openapi.types.ts` reste sync.

## Ajouter un nouveau module

Quand un module backend reçoit ses DTO de réponse Swagger-annotated :

1. Régénérer (cf. section ci-dessus).
2. Étendre `src/lib/api/types.ts` :

   ```ts
   // ─── Inventory ──────────────────────────────────────────────────────
   export type Asset = components['schemas']['AssetResponse'];
   export type ListAssets = components['schemas']['ListAssetsResponse'];
   ```

3. Remplacer les `interface` locaux dans les pages concernées.
4. Vérifier `pnpm --filter frontend typecheck`.
