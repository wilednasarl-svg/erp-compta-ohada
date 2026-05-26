#!/usr/bin/env node
// Smoke test E2E pour Module 3 — flow "balance Sage 8 chiffres".
// signup → org → period 2026 → session (sans documentType) → upload CSV balance
// → preview (suggestion=trial_balance) → patch __documentType → preview
// → commit (auto-provision comptes 8 chiffres) → vérif accounts présents.
//
// Cible : prod Railway. User éphémère smoke-balance-e2e-{ts}@example.com.
// Cleanup via apps/backend/scripts/cleanup-smoke-prod.sql (filtre smoke-%).

const BASE = process.env.BACKEND_URL ?? 'https://backend-production-44c2.up.railway.app';
const TS = Date.now();
const EMAIL = `smoke-balance-e2e-${TS}@example.com`;
const PASSWORD = `SmokeBal!${TS}xy7Z`;
const T0 = Date.now();

const results = []; // { name, ok, detail }
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} ${name}${detail ? ' — ' + detail : ''}`);
}

function unwrap(envelope, label) {
  if (envelope?.error) {
    throw new Error(`${label} → ${envelope.error.code} ${envelope.error.message}`);
  }
  return envelope.data ?? envelope;
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
    throw new Error(`${method} ${path} → HTTP ${res.status} body=${text.slice(0, 400)}`);
  }
  return payload;
}

async function uploadMultipart(url, token, fileBuffer, filename, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([fileBuffer], { type: mime }), filename);
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`upload → HTTP ${res.status} body=${text.slice(0, 400)}`);
  return JSON.parse(text);
}

let orgId = null;
let sessionId = null;

async function main() {
  console.log(`[smoke-balance] base=${BASE}`);
  console.log(`[smoke-balance] user=${EMAIL}`);

  // ── Étape 1 — Setup compte test ───────────────────────────────────
  console.log('\n[1] Setup compte test');
  await http('POST', '/auth/signup', {
    json: { email: EMAIL, password: PASSWORD, firstName: 'SmokeBal', lastName: 'E2E' },
  });
  const login = unwrap(
    await http('POST', '/auth/login', { json: { email: EMAIL, password: PASSWORD } }),
    'login',
  );
  const userToken = login.accessToken;

  const orgEnv = await http('POST', '/organizations', {
    token: userToken,
    json: { name: `Smoke Balance ${TS}`, type: 'company', system: 'NORMAL' },
  });
  const org = unwrap(orgEnv, 'create org');
  orgId = org.organization.id;
  console.log(`    org.id=${orgId}`);

  const sel = unwrap(
    await http('POST', '/auth/select-organization', {
      token: userToken,
      json: { organizationId: orgId },
    }),
    'select org',
  );
  const t = sel.accessToken;

  // Fiscal year 2026 (ANNUAL_ONLY → 1 single period 2026-01-01 → 2026-12-31)
  try {
    unwrap(
      await http('POST', `/organizations/${orgId}/accounting-periods`, {
        token: t,
        json: { year: 2026, split: 'ANNUAL_ONLY' },
      }),
      'create fiscal year 2026',
    );
    console.log(`    fiscal year 2026 created (ANNUAL_ONLY)`);
  } catch (e) {
    console.log(`    [warn] fiscal year create: ${e.message}`);
  }

  // ── Étape 2 — Préparer le fichier balance test ────────────────────
  // CSV balance — 4 comptes 8 chiffres dont préfixes 101, 213, 311, 401
  // matchent PCG SYSCOHADA W1.1 → auto-provisioning attendu.
  // Ligne 99999999 sans parent → reste unknown_account après revalidation
  // → bloque le commit (comportement documenté & attendu : sans parent
  // SYSCOHADA, le compte ne peut pas être créé automatiquement).
  // On garde la ligne mystère pour valider ce contrat E2E, puis on
  // tolère l'échec du commit en assertions séparées.
  const csv = [
    'COMPTE;LIBELLE;DEBIT;CREDIT',
    '10100000;Capital social;0;500000000',
    '21310000;Constructions;300000000;0',
    '31100000;Marchandises;100000000;0',
    '40100000;Fournisseurs;0;100000000',
    '99999999;Compte mystere sans parent;200000000;0',
  ].join('\n');

  // ── Étape 3 — Test suggestion automatique (sans documentType) ─────
  console.log('\n[3] Session sans documentType → upload → preview (suggestion attendue)');
  const sessEnv = await http('POST', `/organizations/${orgId}/imports/sessions`, {
    token: t,
    json: { sourceType: 'csv', label: 'Smoke balance E2E (no docType)' },
  });
  const sess = unwrap(sessEnv, 'create session');
  sessionId = sess.session.id;
  console.log(`    session.id=${sessionId}  documentType=${sess.session.documentType}`);

  const upEnv = await uploadMultipart(
    `${BASE}/organizations/${orgId}/imports/sessions/${sessionId}/files`,
    t,
    Buffer.from(csv, 'utf8'),
    'balance.csv',
    'text/csv',
  );
  const up = unwrap(upEnv, 'upload');
  console.log(`    uploaded: rowsParsed=${up.parsed.rowsParsed} headers=${JSON.stringify(up.parsed.headers)}`);

  const prev1Env = await http('POST', `/organizations/${orgId}/imports/sessions/${sessionId}/preview`, {
    token: t,
    json: {},
  });
  const prev1 = unwrap(prev1Env, 'preview 1');
  console.log(`    preview 1: totals=${JSON.stringify(prev1.totals)} suggested=${prev1.suggestedDocumentType}`);
  console.log(`    headerMapping=${JSON.stringify(prev1.headerMapping)}`);

  console.log('\n  Assertions étape 3 :');
  record(
    'A1: suggestedDocumentType === "trial_balance"',
    prev1.suggestedDocumentType === 'trial_balance',
    `got=${prev1.suggestedDocumentType}`,
  );
  record(
    'A2: errorLines > 0 (mode entries → missing_required_field)',
    prev1.totals.withErrors > 0,
    `withErrors=${prev1.totals.withErrors}`,
  );

  // ── Étape 4 — Bascule en trial_balance ────────────────────────────
  console.log('\n[4] PATCH mapping override avec __documentType=trial_balance');
  const newMapping = { ...prev1.headerMapping, __documentType: 'trial_balance' };
  await http('PATCH', `/organizations/${orgId}/imports/sessions/${sessionId}/mapping`, {
    token: t,
    json: { mappingOverride: newMapping },
  });

  const prev2Env = await http('POST', `/organizations/${orgId}/imports/sessions/${sessionId}/preview`, {
    token: t,
    json: {},
  });
  const prev2 = unwrap(prev2Env, 'preview 2');
  console.log(`    preview 2: totals=${JSON.stringify(prev2.totals)} suggested=${prev2.suggestedDocumentType}`);

  const errorCodes = prev2.entries.flatMap((e) => e.errors.map((er) => er.code));
  const parentHintCount = prev2.entries.filter((e) =>
    e.errors.some((er) => er.code === 'unknown_account_with_parent_hint'),
  ).length;
  const missingReqCount = errorCodes.filter((c) => c === 'missing_required_field').length;
  console.log(`    errorCodes=${JSON.stringify(errorCodes)}`);
  console.log(`    parentHintRows=${parentHintCount} missingReq=${missingReqCount}`);

  console.log('\n  Assertions étape 4 :');
  record(
    'A3: pas de missing_required_field après bascule trial_balance',
    missingReqCount === 0,
    `missingReqCount=${missingReqCount}`,
  );
  record(
    'A4: suggestedDocumentType === null (déjà fixé en trial_balance)',
    prev2.suggestedDocumentType === null,
    `got=${prev2.suggestedDocumentType}`,
  );
  record(
    'A5: >= 4 lignes ont unknown_account_with_parent_hint',
    parentHintCount >= 4,
    `parentHintRows=${parentHintCount}`,
  );

  // ── Étape 5 — Commit ──────────────────────────────────────────────
  // Note : avec la ligne 99999999 SANS parent SYSCOHADA, le commit DOIT
  // échouer en IMPORT_SESSION_NOT_VALID après auto-provisioning des 4
  // autres lignes (l'auto-provision tourne AVANT le check d'erreurs, donc
  // les 4 comptes parent-hint sont créés en DB malgré l'échec final).
  // A6 = "commit rejette proprement le fichier mal préparé (orphan)".
  // A7 = "auto-provisioning a quand même créé les 4 comptes" — validé
  //       via le GET chart-of-accounts à l'étape 6 (A8).
  console.log('\n[5] POST commit (attendu : 409 car ligne 99999999 sans parent)');
  let commitHttpCode = null;
  let commitErrorCode = null;
  let commitResult = null;
  try {
    const commitEnv = await http('POST', `/organizations/${orgId}/imports/sessions/${sessionId}/commit`, {
      token: t,
      json: {},
    });
    commitResult = unwrap(commitEnv, 'commit');
    commitHttpCode = 200;
    console.log(`    commit OK (unexpected): committedRows=${commitResult.committedRows} autoCreatedAccounts=${commitResult.autoCreatedAccounts}`);
  } catch (e) {
    const m = /HTTP (\d+).+code":"([^"]+)/.exec(e.message);
    if (m) {
      commitHttpCode = parseInt(m[1], 10);
      commitErrorCode = m[2];
    }
    console.log(`    commit blocked: HTTP ${commitHttpCode} code=${commitErrorCode}`);
  }

  console.log('\n  Assertions étape 5 :');
  record(
    'A6: commit rejette proprement le fichier (IMPORT_SESSION_NOT_VALID via 99999999 orphan)',
    commitHttpCode === 409 && commitErrorCode === 'IMPORT_SESSION_NOT_VALID',
    `http=${commitHttpCode} code=${commitErrorCode}`,
  );
  record(
    'A7: auto-provisioning a quand même créé des comptes (validé via A8 ci-dessous)',
    true,
    'see A8',
  );

  // ── Vérif comptes auto-créés (indépendant de A6 success) ──────────
  console.log('\n[6] GET chart-of-accounts → vérif présence des 4 comptes 8 chiffres');
  let presentCodes = [];
  try {
    const chartEnv = await http('GET', `/organizations/${orgId}/chart-of-accounts`, { token: t });
    const chart = unwrap(chartEnv, 'list chart');
    const allAccounts = chart.accounts ?? chart;
    const expected = ['10100000', '21310000', '31100000', '40100000'];
    presentCodes = expected.filter((code) => allAccounts.some((a) => a.code === code));
    console.log(`    expected=${JSON.stringify(expected)} present=${JSON.stringify(presentCodes)}`);
  } catch (e) {
    console.log(`    [warn] chart fetch failed: ${e.message}`);
  }

  record(
    'A8: les 4 comptes 8 chiffres présents dans le plan org',
    presentCodes.length === 4,
    `present=${presentCodes.length}/4 — ${presentCodes.join(',')}`,
  );

  // ── Étape 6 — Rapport final ───────────────────────────────────────
  const elapsedMs = Date.now() - T0;
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('\n' + '═'.repeat(60));
  console.log('RECAP FINAL');
  console.log('═'.repeat(60));
  console.log(`Email user   : ${EMAIL}`);
  console.log(`Org ID       : ${orgId}`);
  console.log(`Session ID   : ${sessionId}`);
  console.log(`Elapsed      : ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log(`Assertions   : ${passed}/${results.length} passed`);
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  console.log('═'.repeat(60));
  if (failed === 0) {
    console.log('VERDICT : ✅ PASS');
    process.exit(0);
  } else {
    console.log(`VERDICT : ❌ FAIL — ${failed} assertion(s) failed`);
    console.log(`Cleanup : DELETE WHERE email LIKE 'smoke-%@example.com' (script SQL existant)`);
    process.exit(1);
  }
}

main().catch((err) => {
  const elapsedMs = Date.now() - T0;
  console.error('\n[smoke-balance] ❌ FATAL', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
  console.error('─'.repeat(60));
  console.error(`Email     : ${EMAIL}`);
  console.error(`Org ID    : ${orgId ?? '(not created)'}`);
  console.error(`SessionID : ${sessionId ?? '(not created)'}`);
  console.error(`Elapsed   : ${(elapsedMs / 1000).toFixed(2)}s`);
  console.error(`Partial   : ${results.filter((r) => r.ok).length}/${results.length} assertions passed before fatal`);
  process.exit(1);
});
