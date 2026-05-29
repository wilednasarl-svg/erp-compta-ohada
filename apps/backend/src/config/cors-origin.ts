export function isAllowedCorsOrigin(
  origin: string | undefined,
  appBaseUrl: string | undefined,
): boolean {
  if (origin === undefined) return true;
  if (!appBaseUrl) return true;
  if (origin === appBaseUrl) return true;

  const originHost = hostname(origin);
  const appHost = hostname(appBaseUrl);
  if (!originHost || !appHost) return false;

  const vercelSuffix = '.vercel.app';
  if (!appHost.endsWith(vercelSuffix) || !originHost.endsWith(vercelSuffix)) {
    return false;
  }

  const projectSlug = appHost.slice(0, -vercelSuffix.length);
  return originHost.startsWith(`${projectSlug}-`);
}

export function buildCorsOrigin(appBaseUrl: string | undefined) {
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ): void => {
    callback(null, isAllowedCorsOrigin(origin, appBaseUrl));
  };
}

function hostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}
