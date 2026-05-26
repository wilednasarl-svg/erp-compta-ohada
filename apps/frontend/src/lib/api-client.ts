/**
 * Typed API client for the NestJS backend.
 *
 * Wraps `fetch` with three concerns the rest of the frontend should
 * never have to think about:
 *
 *  1. **Base URL** — every call hits `NEXT_PUBLIC_API_BASE_URL` so the
 *     frontend stays origin-agnostic (Vercel proxy, prod URL, local
 *     dev all just work).
 *  2. **Envelope unwrapping** — the backend returns
 *     `{ data, error }` on success and `{ data: null, error: { code,
 *     message } }` on failure. The client raises an `ApiError` on
 *     failure so call sites get back the unwrapped `data` directly.
 *  3. **Auth header injection** — when a Bearer token is registered
 *     via `setAuthToken()` the client attaches it automatically. The
 *     auth store calls `setAuthToken()` on hydrate / signin / signout
 *     so all hooks just call `api.post(...)` without thinking about
 *     headers.
 */

/**
 * Stable error families exposed to UI code. Mirrors the backend
 * `error-codes.ts` catalogue (see `docs/error-codes.md`). Kept as a
 * string union so a server-side rename surfaces at the call site as a
 * type error.
 */
export type ApiErrorCode =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_EMAIL_TAKEN'
  | 'AUTH_WEAK_PASSWORD'
  | 'AUTH_MFA_REQUIRED'
  | 'AUTH_MFA_INVALID_CODE'
  | 'AUTH_MFA_NOT_ENROLLED'
  | 'AUTH_MFA_ALREADY_ENABLED'
  | 'AUTH_REFRESH_REUSE'
  | 'ORG_NOT_FOUND'
  | 'ORG_LAST_ADMIN'
  | 'ORG_NOTHING_TO_UPDATE'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_PERMISSION'
  | 'FORBIDDEN_NO_MEMBERSHIP'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_ALREADY_USED'
  | 'INVITATION_ALREADY_PENDING'
  | 'INVITATION_REVOKED'
  | 'RBAC_NO_POLICY_DECLARED'
  | 'RBAC_SYSTEM_ROLE_LOCKED'
  | 'CHART_ACCOUNT_NOT_FOUND'
  | 'CHART_ACCOUNT_CODE_TAKEN'
  | 'CHART_ACCOUNT_INVALID_PARENT'
  | 'CHART_ACCOUNT_INVALID_CODE'
  | 'CHART_ACCOUNT_NOT_DELETABLE'
  | 'CHART_ACCOUNT_IMMUTABLE_CODE'
  | 'ACCOUNTING_SYSTEM_REQUIRED'
  // Validation pipe (class-validator) produces VALIDATION_ERROR;
  // network-layer fallthrough produces NETWORK_ERROR.
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

interface ApiErrorBody {
  readonly code: ApiErrorCode | string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode | string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    if (body.details !== undefined) {
      this.details = body.details;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static is(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}

/**
 * Module-level token slot. Set by the auth store on hydrate / signin /
 * signout so request handlers don't have to receive it as a parameter.
 * Kept module-local (not exported) so call sites can only mutate it
 * through `setAuthToken` — keeps the lifecycle explicit.
 */
let currentAuthToken: string | null = null;
let currentRefreshToken: string | null = null;

export function setAuthToken(token: string | null): void {
  currentAuthToken = token;
}

export function getAuthToken(): string | null {
  return currentAuthToken;
}

export function setRefreshToken(token: string | null): void {
  currentRefreshToken = token;
}

/**
 * Callbacks the auth store registers at boot so the API client can
 * (a) persist a rotated token pair and (b) react to a refresh failure
 * without importing the store directly (circular dep).
 */
type TokenPair = { accessToken: string; refreshToken: string };
let onTokensRotated: ((pair: TokenPair) => void) | null = null;
let onAuthExpired: (() => void) | null = null;

export function setOnTokensRotated(handler: ((pair: TokenPair) => void) | null): void {
  onTokensRotated = handler;
}

export function setOnAuthExpired(handler: (() => void) | null): void {
  onAuthExpired = handler;
}

/**
 * Single-flight refresh. Multiple concurrent 401s share the same
 * `/auth/refresh` call — without this, a page that fans out 5 queries
 * on mount would race 5 refreshes against the backend's reuse-detection
 * and only one would succeed (the others would burn the rotated token).
 */
let inflightRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (currentRefreshToken === null) return null;
  if (inflightRefresh !== null) return inflightRefresh;

  const presented = currentRefreshToken;
  inflightRefresh = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: presented }),
        credentials: 'include',
      });
      const json = (await res.json().catch(() => null)) as
        | { data?: TokenPair | null; error?: ApiErrorBody | null }
        | null;
      if (!res.ok || !json || !json.data) {
        onAuthExpired?.();
        return null;
      }
      currentAuthToken = json.data.accessToken;
      currentRefreshToken = json.data.refreshToken;
      onTokensRotated?.(json.data);
      return json.data.accessToken;
    } catch {
      onAuthExpired?.();
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

const BASE_URL: string =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

interface RequestOptions {
  readonly body?: Json | Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  /**
   * Skip the Authorization header injection. Used by the public
   * endpoints (login, signup, refresh, accept-invitation).
   */
  readonly anonymous?: boolean;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {},
  retryOn401: boolean = true,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.anonymous !== true && currentAuthToken !== null) {
      h['Authorization'] = `Bearer ${currentAuthToken}`;
    }
    return h;
  };

  const doFetch = async (): Promise<Response> =>
    fetch(url, {
      method,
      headers: buildHeaders(),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: 'include',
    });

  let response: Response;
  try {
    response = await doFetch();
  } catch (cause: unknown) {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: cause instanceof Error ? cause.message : 'Network request failed',
    });
  }

  // 401 → try one refresh + replay before surfacing the error. Skip for
  // anonymous calls (login/signup/refresh) and when we've already retried,
  // to avoid infinite loops.
  if (
    response.status === 401 &&
    retryOn401 &&
    options.anonymous !== true &&
    path !== '/auth/refresh'
  ) {
    const newAccess = await refreshAccessToken();
    if (newAccess !== null) {
      try {
        response = await doFetch();
      } catch (cause: unknown) {
        throw new ApiError(0, {
          code: 'NETWORK_ERROR',
          message: cause instanceof Error ? cause.message : 'Network request failed',
        });
      }
    }
  }

  // 204 No Content has no body to parse; treat as success with undefined.
  if (response.status === 204) {
    return undefined as T;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(response.status, {
      code: 'UNKNOWN_ERROR',
      message: `Backend returned a non-JSON ${response.status} response`,
    });
  }

  // Backend envelope: { data, error }. Anything else (e.g. a raw error
  // from a non-application layer like NGINX) is wrapped defensively.
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ApiError(response.status, {
      code: 'UNKNOWN_ERROR',
      message: 'Backend response is not an object',
    });
  }

  const envelope = parsed as { data?: unknown; error?: ApiErrorBody | null };

  // `envelope.error` is `null` on success per the backend interceptor
  // contract. Use loose-null check so a 200 response that omits the
  // field (`error: undefined`) doesn't get mistaken for an error.
  if (!response.ok || envelope.error != null) {
    const errBody: ApiErrorBody =
      envelope.error ?? {
        code: 'UNKNOWN_ERROR',
        message: `Unexpected ${response.status} response`,
      };
    throw new ApiError(response.status, errBody);
  }

  return envelope.data as T;
}

/**
 * Trigger a file download (xlsx, pdf, zip…) from a backend endpoint.
 *
 * `window.open('/api/…')` cannot work for two reasons: (1) the frontend
 * domain has no `/api/*` route or rewrite — the real backend lives at
 * `NEXT_PUBLIC_API_BASE_URL`; (2) `window.open` cannot inject the
 * `Authorization: Bearer` header that `request()` adds. This helper
 * fetches the resource as a blob (with auth + 401 refresh-retry) and
 * triggers a synthetic `<a download>` click.
 *
 * The filename falls back to the server's `Content-Disposition` header
 * when the caller does not provide one explicitly.
 */
async function downloadFile(
  path: string,
  fallbackFilename: string,
  retryOn401: boolean = true,
): Promise<void> {
  const url = `${BASE_URL}${path}`;
  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {};
    if (currentAuthToken !== null) {
      h['Authorization'] = `Bearer ${currentAuthToken}`;
    }
    return h;
  };

  const doFetch = async (): Promise<Response> =>
    fetch(url, { method: 'GET', headers: buildHeaders(), credentials: 'include' });

  let response: Response;
  try {
    response = await doFetch();
  } catch (cause: unknown) {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: cause instanceof Error ? cause.message : 'Network request failed',
    });
  }

  if (response.status === 401 && retryOn401) {
    const newAccess = await refreshAccessToken();
    if (newAccess !== null) {
      try {
        response = await doFetch();
      } catch (cause: unknown) {
        throw new ApiError(0, {
          code: 'NETWORK_ERROR',
          message: cause instanceof Error ? cause.message : 'Network request failed',
        });
      }
    }
  }

  if (!response.ok) {
    let body: ApiErrorBody = {
      code: 'UNKNOWN_ERROR',
      message: `Backend returned ${response.status}`,
    };
    try {
      const parsed = (await response.json()) as { error?: ApiErrorBody };
      if (parsed.error) body = parsed.error;
    } catch {
      // Non-JSON body — keep the default message.
    }
    throw new ApiError(response.status, body);
  }

  const filename = extractFilename(response.headers.get('Content-Disposition')) ?? fallbackFilename;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke after a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function extractFilename(contentDisposition: string | null): string | null {
  if (contentDisposition === null) return null;
  // Prefer RFC 5987 `filename*=UTF-8''…` (handles accents), then plain `filename="…"`.
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8 && utf8[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
  return plain && plain[1] ? plain[1].trim() : null;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('GET', path, options),
  post: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions): Promise<T> =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions): Promise<T> =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, options),
  download: (path: string, fallbackFilename: string): Promise<void> =>
    downloadFile(path, fallbackFilename),
};
