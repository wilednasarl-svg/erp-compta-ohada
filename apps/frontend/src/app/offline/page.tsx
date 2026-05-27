export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <svg
        className="h-16 w-16 text-accent-ink opacity-60"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 3l18 18M10.584 10.587a2 2 0 002.828 2.83m-4.243-4.244a4 4 0 015.657 5.657M3.465 3.465A9 9 0 0120.536 20.536"
        />
      </svg>
      <div>
        <h1 className="font-fraunces text-2xl font-semibold text-ink">
          Connexion indisponible
        </h1>
        <p className="mt-2 text-sm text-ink-mute">
          Vérifiez votre réseau et réessayez.
          <br />
          Les données déjà consultées restent accessibles hors-ligne.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-paper transition hover:opacity-90"
      >
        Réessayer
      </button>
    </div>
  );
}
