'use client';

/**
 * Dernier filet de sécurité : ne se déclenche que si le layout racine lui-même
 * échoue. Il remplace `<html>`/`<body>`, donc styles inline (la CSS globale
 * n'est pas garantie ici) avec les valeurs OKLCH de la marque.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          padding: '24px',
          textAlign: 'center',
          backgroundColor: 'oklch(98.5% 0.005 85)',
          color: 'oklch(10% 0.010 270)',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Une erreur est survenue</h1>
        <p style={{ maxWidth: '42ch', fontSize: '14px', lineHeight: 1.6, color: 'oklch(26% 0.010 270)', margin: 0 }}>
          L&apos;application a rencontré un problème inattendu. Réessayez ; si cela persiste,
          rechargez la page.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            border: 'none',
            cursor: 'pointer',
            borderRadius: '6px',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 500,
            backgroundColor: 'oklch(45% 0.10 155)',
            color: 'oklch(98% 0.004 85)',
          }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
