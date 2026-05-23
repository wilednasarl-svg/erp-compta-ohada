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

export function setAuthToken(token: string | null): void {
  currentAuthToken = token;
}

export function getAuthToken(): string | null {
  return currentAuthToken;
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
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers,
  };
  if (options.anonymous !== true && currentAuthToken !== null) {
    headers['Authorization'] = `Bearer ${currentAuthToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: 'include',
    });
  } catch (cause: unknown) {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: cause instanceof Error ? cause.message : 'Network request failed',
    });
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

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('GET', path, options),
  post: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions): Promise<T> =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions): Promise<T> =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, options),
};
