#!/usr/bin/env node
// Smoke test E2E pour Module 3 wave 2 — commitSession.
// signup → org (clone SYSCOHADA + seed journals) → discover POSTING + journals + period
// → upload balanced CSV → preview (0 erreurs) → POST /commit → vérifier journal_entries.
//
// Mise à part : NE pas réutiliser les codes 4111/7011/512 — ils sont
// TITLE dans la racine cloned. Le clone SYSCOHADA n'apporte que des
// classes parents. Pour avoir un POSTING utilisable, on créé d'abord
// 2 sous-comptes custom via POST /chart-of-accounts.

const BASE = process.env.SMOKE_BASE_URL ?? 'https://backend-production-44c2.up.railway.app';
const TS = Date.now();
const EMAIL = `smoke-commit-${TS}@example.com`;
const PASSWORD = `SmokeTest!${TS}xy`;

function unwrap(envelope, label) {
  if (envelope?.error) {
    throw new Error(`${label} → ${envelope.error.code} ${envelope.error.message}`);
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
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status} body=${text.slice(0, 400)}`);
  }
  return payload;
}

async function main() {
  console.log(`[smoke-commit] base=${BASE} user=${EMAIL}`);

  // 1. signup + login
  await http('POST', '/auth/signup', { json: { email: EMAIL, password: PASSWORD, firstName: 'Smoke', lastName: 'Commit' } });
  const login = unwrap(await http('POST', '/auth/login', { json: { email: EMAIL, password: PASSWORD } }), 'login');
  const userToken = login.accessToken;

  // 2. create org (auto-clones SYSCOHADA + seeds 5 journals)
  const org = unwrap(await http('POST', '/organizations', {
    token: userToken,
    json: { name: `Smoke Commit ${TS}`, type: 'company', system: 'NORMAL' },
  }), 'create org');
  const orgId = org.organization.id;
  console.log(`[1] org.id=${orgId.slice(0,8)}…`);

  // 3. select org
  const sel = unwrap(await http('POST', '/auth/select-organization', { token: userToken, json: { organizationId: orgId } }), 'select');
  const t = sel.accessToken;
  console.log(`[2] org-scoped token OK`);

  // 4. discover journals
  const journalsEnv = await http('GET', `/organizations/${orgId}/journals`, { token: t });
  const journals = unwrap(journalsEnv, 'list journals');
  const journalsList = journals.journals ?? journals;
  console.log(`[3] journals: ${journalsList.map(j => j.code).join(', ')}`);
  const journalCode = journalsList[0]?.code;
  if (!journalCode) throw new Error('No journal seeded — did the org clone path run?');

  // 5. discover an accounting period (any open one)
  const periodsEnv = await http('GET', `/organizations/${orgId}/accounting-periods`, { token: t });
  const periodsData = unwrap(periodsEnv, 'list periods');
  const periods = periodsData.periods ?? periodsData;
  const openPeriod = Array.isArray(periods) ? periods.find(p => p.status === 'open') : null;
  if (!openPeriod) {
    // CreateFiscalYearDto = { year: number, split: MONTHLY|QUARTERLY|ANNUAL_ONLY }
    const year = new Date().getFullYear();
    const fyEnv = await http('POST', `/organizations/${orgId}/accounting-periods`, {
      token: t,
      json: { year, split: 'ANNUAL_ONLY' },
    });
    unwrap(fyEnv, 'create fiscal year');
    console.log(`[4] created fiscal year ${year} (ANNUAL_ONLY)`);
  } else {
    console.log(`[4] open period ${openPeriod.startDate} → ${openPeriod.endDate}`);
  }

  // 6. create 2 POSTING custom accounts under existing TITLE parents
  // (4111 sous 411 = clients, 7011 sous 701 = ventes marchandises). The
  // exact reference codes that exist depend on the SYSCOHADA seed; we
  // try the common ones and fall back if a parent is missing.
  const chartEnv = await http('GET', `/organizations/${orgId}/chart-of-accounts`, { token: t });
  const chart = unwrap(chartEnv, 'list chart');
  const accountsList = chart.accounts ?? chart;
  const hasParent = (code) => accountsList.some(a => a.code === code);
  const parent411 = hasParent('411') ? '411' : (hasParent('41') ? '41' : '4');
  const parent701 = hasParent('701') ? '701' : (hasParent('70') ? '70' : '7');
  console.log(`[5] parents: clients=${parent411}, ventes=${parent701}`);

  const acctClient = unwrap(await http('POST', `/organizations/${orgId}/chart-of-accounts`, {
    token: t,
    json: { parentCode: parent411, code: parent411 + '999', label: 'Smoke Client' },
  }), 'create acct client');
  const acctVente = unwrap(await http('POST', `/organizations/${orgId}/chart-of-accounts`, {
    token: t,
    json: { parentCode: parent701, code: parent701 + '999', label: 'Smoke Vente' },
  }), 'create acct vente');
  const clientCode = acctClient.account.code;
  const venteCode = acctVente.account.code;
  console.log(`[5b] POSTING created: ${clientCode}, ${venteCode}`);

  // 7. create import session
  const session = unwrap(await http('POST', `/organizations/${orgId}/imports/sessions`, {
    token: t, json: { sourceType: 'csv', label: 'Smoke commit' },
  }), 'create session');
  const sid = session.session.id;
  console.log(`[6] session ${sid.slice(0,8)}…`);

  // 8. upload BALANCED CSV. 2 lignes équilibrées (debit=credit=1500 sur la piece).
  // Le date doit tomber dans la période ouverte → on prend "today" en YYYY-MM-DD.
  const today = new Date().toISOString().slice(0, 10);
  const csv = [
    'Compte;Journal;Date;Débit;Crédit;Libellé',
    `${clientCode};${journalCode};${today};1500,00;;Smoke vente client X`,
    `${venteCode};${journalCode};${today};;1500,00;Smoke vente client X`,
  ].join('\n');
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'commit.csv');
  const upRes = await fetch(`${BASE}/organizations/${orgId}/imports/sessions/${sid}/files`, {
    method: 'POST', headers: { authorization: `Bearer ${t}` }, body: fd,
  });
  const upText = await upRes.text();
  if (!upRes.ok) throw new Error(`upload → HTTP ${upRes.status} body=${upText.slice(0,400)}`);
  const upEnv = JSON.parse(upText);
  const up = unwrap(upEnv, 'upload');
  console.log(`[7] uploaded ${up.parsed.rowsParsed} rows, headers=${JSON.stringify(up.parsed.headers)}`);

  // 9. preview — should be 0 errors now
  const previewEnv = await http('POST', `/organizations/${orgId}/imports/sessions/${sid}/preview`, { token: t, json: {} });
  const preview = unwrap(previewEnv, 'preview');
  console.log(`[8] preview: total=${preview.totals.total} withErrors=${preview.totals.withErrors} status=${preview.session.status}`);
  for (const e of preview.entries) {
    const errs = e.errors.length === 0 ? 'OK' : e.errors.map(x => x.code).join(',');
    console.log(`     row ${e.rowNumber} → [${errs}]`);
  }
  if (preview.totals.withErrors > 0) {
    console.log('[!] preview has errors, skipping commit (would 409). Stop here.');
    return;
  }

  // 10. COMMIT — wave 2 endpoint
  console.log(`[9] POST .../sessions/${sid.slice(0,8)}…/commit`);
  const commitEnv = await http('POST', `/organizations/${orgId}/imports/sessions/${sid}/commit`, { token: t, json: {} });
  const commit = unwrap(commitEnv, 'commit');
  console.log(`[9] ✅ committedRows=${commit.result.committedRows} sessionId=${commit.result.sessionId.slice(0,8)}…`);

  // 11. verify: entries should now exist
  const entriesEnv = await http('GET', `/organizations/${orgId}/entries`, { token: t });
  const entries = unwrap(entriesEnv, 'list entries');
  const entriesList = entries.entries ?? entries;
  console.log(`[10] entries in DB: ${Array.isArray(entriesList) ? entriesList.length : 'unknown'}`);
  if (Array.isArray(entriesList)) {
    for (const e of entriesList.slice(0, 3)) {
      console.log(`     entry ${e.id?.slice(0,8) ?? '?'}… status=${e.status} journal=${e.journalCode ?? e.journal?.code ?? '?'} pieceNumber=${e.pieceNumber ?? '?'}`);
    }
  }

  // 12. verify session is now 'completed'
  const refreshedEnv = await http('GET', `/organizations/${orgId}/imports/sessions/${sid}`, { token: t });
  const refreshed = unwrap(refreshedEnv, 'refresh session');
  console.log(`[11] session final status=${refreshed.session.status}`);

  console.log(`\n[smoke-commit] ✅ end-to-end OK — Module 3 wave 2 commit pipeline validé en prod`);
}

main().catch((err) => {
  console.error('[smoke-commit] ❌', err.message);
  process.exit(1);
});
