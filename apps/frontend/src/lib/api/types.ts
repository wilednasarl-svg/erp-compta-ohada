/**
 * Aliases pratiques pour les types générés depuis l'OpenAPI spec
 * du backend (`/docs-json`).
 *
 * Source de vérité : `apps/backend/src/modules/**\/dto/responses/*.response.ts`.
 *
 * Régénérer après tout changement de contrat backend :
 *   1. Lancer le backend : `pnpm --filter backend start:dev`
 *   2. Régénérer        : `pnpm --filter frontend generate:api-types`
 *   3. Commit du fichier `openapi.types.ts` mis à jour.
 *
 * Cette liste sera étendue aux autres modules au fil du rollout des
 * DTO backend (auth, inventory, accounting, etc.). NE PAS dupliquer
 * manuellement les shapes ici — ajoutez systématiquement un alias qui
 * pointe vers `components['schemas'][...]`.
 */
import type { components } from './openapi.types';

// ─── TVA ─────────────────────────────────────────────────────────────
export type TvaDeclaration = components['schemas']['TvaDeclarationResponse'];
export type TvaDeclarationLine =
  components['schemas']['TvaDeclarationLineResponse'];
export type TvaCode = components['schemas']['TvaCodeResponse'];

export type ListTvaDeclarations =
  components['schemas']['ListTvaDeclarationsResponse'];
export type TvaDeclarationEnvelope =
  components['schemas']['TvaDeclarationEnvelopeResponse'];
export type ListTvaCodes = components['schemas']['ListTvaCodesResponse'];
export type TvaCodeEnvelope = components['schemas']['TvaCodeEnvelopeResponse'];

// Sous-types extraits pour réutilisation dans les composants (selects, etc.).
export type TvaCodeType = TvaCode['type'];
export type TvaCodeKind = TvaCode['kind'];
export type TvaDeclarationStatus = TvaDeclaration['status'];
export type TvaDeclarationLineDirection = TvaDeclarationLine['direction'];
