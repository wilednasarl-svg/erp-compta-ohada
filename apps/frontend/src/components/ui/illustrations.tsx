/**
 * Illustrations « spot » maison — direction papier ivoire.
 *
 * Trait fin à `currentColor` (réglé par la couleur de texte du parent), accents
 * en vert de marque via les tokens OKLCH pour la `IllustrationPlant`, monochrome
 * pour les autres (elles prennent la teinte sémantique de leur contexte). Pensées
 * pour les MOMENTS (onboarding, choix, états vides), pas les pages denses.
 * Aucune dépendance, aucun asset binaire : du SVG inline, net à toute taille.
 */

interface IllustrationProps {
  readonly className?: string;
}

const LINE = {
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};
const ACCENT = 'oklch(var(--accent))';
const ACCENT_SOFT = 'oklch(var(--accent-soft))';

/** Pousse en pot — un dossier qui démarre et grandit. Feuilles en vert de marque. */
export function IllustrationPlant({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 116" fill="none" role="img" aria-hidden className={className}>
      <g {...LINE} stroke={ACCENT} fill={ACCENT_SOFT}>
        <path d="M60 60 C49 59 41 51 38 41 C49 42 57 50 60 60 Z" />
        <path d="M60 52 C71 51 79 43 82 33 C71 34 63 42 60 52 Z" />
        <path d="M60 46 C57 35 58 26 60 18 C62 26 63 35 60 46 Z" />
      </g>
      <g {...LINE}>
        <path d="M60 82 C60 70 60 60 60 46" />
        <path d="M38 82 H82 L75 106 H45 Z" />
        <path d="M34 82 H86" />
        <path d="M47 90 H73" stroke={ACCENT} opacity={0.55} />
      </g>
    </svg>
  );
}

/** Pastille validée + étincelles — « tout est en ordre », états vides positifs. */
export function IllustrationCheck({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" fill="none" role="img" aria-hidden className={className}>
      <circle cx="60" cy="50" r="28" stroke={ACCENT} strokeWidth={2.2} fill={ACCENT_SOFT} />
      <path
        d="M48 50 l8 8 L74 40"
        fill="none"
        stroke={ACCENT}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g stroke={ACCENT} strokeWidth={2} strokeLinecap="round" opacity={0.85}>
        <path d="M97 20 V29 M92.5 24.5 H101.5" />
        <path d="M23 26 V33 M19.5 29.5 H26.5" />
      </g>
      <circle cx="99" cy="66" r="2.4" fill={ACCENT} />
      <circle cx="21" cy="58" r="2" fill={ACCENT} />
    </svg>
  );
}

/** Courbe ascendante — pilotage, direction. Monochrome (prend la teinte du parent). */
export function IllustrationChart({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" fill="none" role="img" aria-hidden className={className}>
      <path {...LINE} d="M26 18 V74 H102" opacity={0.45} />
      <path
        d="M32 64 L50 52 L64 58 L80 38 L100 28"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="currentColor">
        <circle cx="50" cy="52" r="2.8" />
        <circle cx="80" cy="38" r="2.8" />
        <circle cx="100" cy="28" r="2.8" />
      </g>
    </svg>
  );
}

/** Balance — équilibre, analyse financière. Monochrome. */
export function IllustrationScale({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" fill="none" role="img" aria-hidden className={className}>
      <g {...LINE}>
        <path d="M60 28 V74" />
        <path d="M46 78 H74" />
        <path d="M30 36 H90" />
        <path d="M30 36 L23 54 M30 36 L37 54" />
        <path d="M90 36 L83 54 M90 36 L97 54" />
        <path d="M21 54 Q30 66 39 54" />
        <path d="M81 54 Q90 66 99 54" />
      </g>
      <circle cx="60" cy="26" r="3.4" fill="currentColor" />
    </svg>
  );
}

/** Grand-livre ouvert + courbe d'analyse — « du journal à la maîtrise ». Monochrome. */
export function IllustrationLedger({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 188 132" fill="none" role="img" aria-hidden className={className}>
      <g {...LINE}>
        <path d="M94 108 L30 100 V54 L94 62 Z" />
        <path d="M94 108 L158 100 V54 L94 62 Z" />
        <path d="M94 62 V108" />
        <g opacity={0.5}>
          <path d="M42 72 L82 77 M42 82 L82 87 M42 92 L74 96" />
          <path d="M106 77 L146 72 M106 87 L146 82 M114 96 L146 92" />
        </g>
      </g>
      <path
        d="M46 46 L74 30 L98 38 L124 18 L152 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="currentColor">
        <circle cx="74" cy="30" r="2.8" />
        <circle cx="124" cy="18" r="2.8" />
        <circle cx="152" cy="9" r="2.8" />
      </g>
    </svg>
  );
}

/** Loupe + « ? » — page introuvable (404). */
export function IllustrationNotFound({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 116" fill="none" role="img" aria-hidden className={className}>
      <g {...LINE}>
        <circle cx="50" cy="48" r="26" />
        <path d="M70 68 L90 88" strokeWidth={3.2} />
      </g>
      <text
        x="50"
        y="58"
        textAnchor="middle"
        fontSize="28"
        fontWeight="600"
        fill={ACCENT}
        fontFamily="var(--font-fraunces), Georgia, serif"
      >
        ?
      </text>
    </svg>
  );
}

/** Maillon rompu — connexion indisponible (page hors-ligne). */
export function IllustrationOffline({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 132 80" fill="none" role="img" aria-hidden className={className}>
      <g {...LINE}>
        <path d="M62 26 H42 a14 14 0 0 0 0 28 h20" />
        <path d="M70 26 H90 a14 14 0 0 1 0 28 H70" />
      </g>
      <g stroke={ACCENT} strokeWidth={2.4} strokeLinecap="round">
        <path d="M66 16 v8" />
        <path d="M66 56 v8" />
        <path d="M78 14 l-4 7" opacity={0.7} />
        <path d="M54 14 l4 7" opacity={0.7} />
      </g>
    </svg>
  );
}

/** Documents + coche — suivi opérationnel, à traiter. Monochrome. */
export function IllustrationDocs({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" fill="none" role="img" aria-hidden className={className}>
      <g {...LINE}>
        <rect x="44" y="16" width="46" height="60" rx="5" opacity={0.45} />
        <rect x="30" y="26" width="46" height="60" rx="5" fill="oklch(var(--paper))" />
        <path d="M40 56 H66 M40 66 H58" opacity={0.5} />
      </g>
      <path
        d="M39 44 l5 5 L53 39"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
