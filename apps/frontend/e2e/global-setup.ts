import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Global-setup Playwright : amorce une session authentifiée sans passer par
 * l'UI de login. Il crée un utilisateur + une organisation neufs via l'API
 * backend, sélectionne l'org, puis écrit un `storageState` qui injecte
 * l'état persistant de l'auth-store (`erp-compta-auth/v1`) dans localStorage.
 * Les tests démarrent ainsi connectés et org-sélectionnés sur un dossier
 * VIDE — suffisant pour exercer tout le parcours console + le câblage
 * AC-V5 (« Aucune écriture » avant génération).
 */
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const STATE_PATH = './e2e/.auth/state.json';

interface Json {
  readonly [k: string]: unknown;
}

async function call(path: string, body: Json, token?: string): Promise<Json> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status} : ${JSON.stringify(json)}`);
  }
  return (json.data as Json) ?? json;
}

export default async function globalSetup(): Promise<void> {
  const email = `e2e+${Date.now().toString(36)}@e2e.test`;
  const password = 'TestTest2026!';

  await call('/auth/signup', { email, password, firstName: 'E2E', lastName: 'Console' });
  const login = await call('/auth/login', { email, password });
  const bootToken = login.accessToken as string;

  const created = await call(
    '/organizations',
    { name: 'Cabinet E2E Console', type: 'firm', system: 'NORMAL' },
    bootToken,
  );
  const createdOrg = (created.organization as Json | undefined) ?? created;
  const orgId = createdOrg.id as string;

  const selected = await call('/auth/select-organization', { organizationId: orgId }, bootToken);
  const selectedOrg = (selected.organization as Json | undefined) ?? createdOrg;
  const orgSummary = {
    id: orgId,
    name: (selectedOrg.name as string) ?? 'Cabinet E2E Console',
    role: (selectedOrg.role as string) ?? 'admin',
  };

  const snapshot = {
    accessToken: selected.accessToken,
    refreshToken: selected.refreshToken,
    user: login.user,
    organizations: [orgSummary],
    currentOrg: orgSummary,
  };

  const state = {
    cookies: [],
    origins: [
      {
        origin: BASE_URL,
        localStorage: [
          { name: 'erp-compta-auth/v1', value: JSON.stringify({ state: snapshot, version: 0 }) },
        ],
      },
    ],
  };

  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  // eslint-disable-next-line no-console -- harness e2e : stdout EST l'UX
  console.log(`[pw] org ${orgId} créée + sélectionnée ; storageState écrit → ${STATE_PATH}`);
}
