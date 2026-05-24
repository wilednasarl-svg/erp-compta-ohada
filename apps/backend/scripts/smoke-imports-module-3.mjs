#!/usr/bin/env node
// Smoke test E2E pour Module 3 — Import engine, en prod.
// signup → create org → create session → upload CSV → preview
// Idempotent : crée un user/org éphémère (timestamp dans l'email +
// slug) puis sort. Le user/org reste en DB (cleanup à faire à la main
// si nécessaire — pas d'endpoint DELETE org public à ce stade).

const BASE = process.env.SMOKE_BASE_URL ?? 'https://backend-production-44c2.up.railway.app';
const TS = Date.now();
const EMAIL = `smoke-import-${TS}@example.com`;
const PASSWORD = `SmokeTest!${TS}xy`;

function unwrap(envelope, label) {
  if (envelope?.error) {
    throw new Error(`${label} → error.code=${envelope.error.code} message=${envelope.error.message}`);
  }
  return envelope.data;
}

async function http(method, path, { token, json, body, headers } = {}) {
  const h = { ...(headers ?? {}) };
  if (json !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status} body=${text.slice(0, 300)}`);
  }
  return payload;
}

async function main() {
  console.log(`[smoke] base=${BASE}`);
  console.log(`[smoke] test user=${EMAIL}`);

  // 1. signup (no token returned — must login next)
  console.log('\n[1] POST /auth/signup');
  const signup = unwrap(
    await http('POST', '/auth/signup', {
      json: { email: EMAIL, password: PASSWORD, firstName: 'Smoke', lastName: 'Test' },
    }),
    'signup',
  );
  console.log(`    → user.id=${signup.user.id.slice(0, 8)}…`);

  // 1b. login → access token
  console.log('[1b] POST /auth/login');
  const login = unwrap(
    await http('POST', '/auth/login', { json: { email: EMAIL, password: PASSWORD } }),
    'login',
  );
  const userToken = login.accessToken;
  if (!userToken) throw new Error('login: missing accessToken');
  console.log(`    → token len=${userToken.length}  organizations=${login.organizations.length}`);

  // 2. create organization
  console.log('\n[2] POST /organizations (type=company, system=NORMAL)');
  const orgEnv = await http('POST', '/organizations', {
    token: userToken,
    json: { name: `Smoke Org ${TS}`, type: 'company', system: 'NORMAL' },
  });
  const org = unwrap(orgEnv, 'create org');
  const orgId = org.organization.id;
  console.log(`    → org.id=${orgId}  slug=${org.organization.slug}`);

  // 3. select organization → org-scoped token
  console.log('\n[3] POST /auth/select-organization');
  const selectEnv = await http('POST', '/auth/select-organization', {
    token: userToken,
    json: { organizationId: orgId },
  });
  const sel = unwrap(selectEnv, 'select org');
  const orgToken = sel.accessToken;
  console.log(`    → org-scoped token len=${orgToken.length}`);

  // 4. create import session
  console.log(`\n[4] POST /organizations/${orgId.slice(0, 8)}…/imports/sessions`);
  const sessEnv = await http('POST', `/organizations/${orgId}/imports/sessions`, {
    token: orgToken,
    json: { sourceType: 'csv', label: 'Smoke test session' },
  });
  const sess = unwrap(sessEnv, 'create session');
  const sessionId = sess.session.id;
  console.log(`    → session.id=${sessionId.slice(0, 8)}…  status=${sess.session.status}`);

  // 5. upload CSV (multipart). Tiny payload — headers FR + 3 lines.
  console.log(`\n[5] POST .../sessions/${sessionId.slice(0, 8)}…/files (multipart CSV)`);
  const csv = [
    'Compte;Journal;Date;Débit;Crédit;Libellé',
    '4111;VTE;15/03/2024;1500,00;;Vente facture FAC-001',
    '7011;VTE;15/03/2024;;1500,00;Vente facture FAC-001',
    '4111;VTE;not-a-date;abc;;Ligne volontairement cassée',
  ].join('\n');
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'smoke.csv');
  const upRes = await fetch(`${BASE}/organizations/${orgId}/imports/sessions/${sessionId}/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${orgToken}` },
    body: fd,
  });
  const upText = await upRes.text();
  if (!upRes.ok) throw new Error(`upload → HTTP ${upRes.status} body=${upText.slice(0, 300)}`);
  const upEnv = JSON.parse(upText);
  const up = unwrap(upEnv, 'upload file');
  console.log(`    → file.id=${up.fileId.slice(0, 8)}…  rowsParsed=${up.parsed.rowsParsed}  headers=${JSON.stringify(up.parsed.headers)}`);

  // 6. preview
  console.log(`\n[6] POST .../sessions/${sessionId.slice(0, 8)}…/preview`);
  const prevEnv = await http('POST', `/organizations/${orgId}/imports/sessions/${sessionId}/preview`, {
    token: orgToken,
    json: {},
  });
  const prev = unwrap(prevEnv, 'preview');
  console.log(`    → totals=${JSON.stringify(prev.totals)}  status=${prev.session.status}`);
  console.log(`    → headerMapping=${JSON.stringify(prev.headerMapping)}`);
  console.log(`    → unmappedTargets=${JSON.stringify(prev.unmappedTargets)}`);
  for (const e of prev.entries) {
    const errs = e.errors.length === 0 ? 'OK' : e.errors.map((x) => x.code).join(',');
    console.log(`      row ${e.rowNumber} → mapped=${JSON.stringify(e.mappedValues)} errors=[${errs}]`);
  }

  console.log('\n[smoke] ✅ end-to-end OK');
  console.log(`[smoke] residual prod data: user ${EMAIL} + org ${orgId.slice(0, 8)} (no public DELETE endpoint yet)`);
}

main().catch((err) => {
  console.error('[smoke] ❌', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
