import { AlertCircle } from 'lucide-react';

import type { ApiErrorCode } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Map a backend `ApiErrorCode` to a user-friendly French message. The
 * mapping lives here (not in the API client) so the wire contract stays
 * locale-agnostic and l18n is a pure UI concern.
 *
 * Codes outside the catalog fall back to the raw message — preferable
 * to a vague "Une erreur est survenue" because real users (and the
 * support team triaging logs) need the specifics to react.
 */
const FRENCH_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: 'Email ou mot de passe incorrect.',
  AUTH_INVALID_TOKEN: 'Votre session a expiré. Reconnectez-vous.',
  AUTH_EMAIL_TAKEN: 'Cet email est déjà utilisé.',
  AUTH_WEAK_PASSWORD: 'Mot de passe trop court (12 caractères minimum).',
  AUTH_MFA_INVALID_CODE: 'Code MFA incorrect.',
  AUTH_MFA_NOT_ENROLLED: 'MFA non activé sur ce compte.',
  AUTH_MFA_ALREADY_ENABLED: 'MFA déjà activé sur ce compte.',
  AUTH_REFRESH_REUSE: 'Session compromise. Reconnectez-vous.',
  ORG_NOT_FOUND: "Organisation introuvable.",
  ORG_LAST_ADMIN: "Impossible de retirer le dernier admin actif de l'organisation.",
  ORG_NOTHING_TO_UPDATE: 'Aucun champ à mettre à jour.',
  FORBIDDEN_ROLE: "Votre rôle n'autorise pas cette action.",
  FORBIDDEN_PERMISSION: "Vous n'avez pas la permission requise.",
  FORBIDDEN_NO_MEMBERSHIP: 'Sélectionnez une organisation pour continuer.',
  INVITATION_NOT_FOUND: 'Invitation introuvable.',
  INVITATION_EXPIRED: 'Invitation expirée. Demandez-en une nouvelle.',
  INVITATION_ALREADY_USED: 'Invitation déjà utilisée.',
  INVITATION_ALREADY_PENDING: 'Une invitation est déjà en attente pour cet email.',
  INVITATION_REVOKED: 'Invitation révoquée.',
  VALIDATION_ERROR: 'Données invalides — vérifiez le formulaire.',
  NETWORK_ERROR: 'Connexion au serveur impossible. Réessayez.',
};

interface FormErrorProps {
  readonly error?: { code?: string; message?: string } | null;
  readonly className?: string;
}

export function FormError({ error, className }: FormErrorProps) {
  if (error === null || error === undefined) {
    return null;
  }
  const localized =
    typeof error.code === 'string'
      ? FRENCH_MESSAGES[error.code as ApiErrorCode] ?? error.message ?? 'Erreur inconnue'
      : error.message ?? 'Erreur inconnue';

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 ' +
          'px-3 py-2 text-sm text-destructive',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{localized}</span>
    </div>
  );
}
