#!/usr/bin/env node
// Bypass commitSession — call POST /entries directly with the exact
// shape that commitSession would produce. Isolates whether the bug
// lives in EntriesService.createDraft or in ImportSessionService.commitSession.
const BASE = 'https://backend-production-44c2.up.railway.app';
const TS = Date.now();
const EMAIL = `probe-entry-${TS}@example.com`;
const PASSWORD = `Probe!${TS}xy`;

const unwrap = (e, l) => { if (e?.error) throw new Error(`${l}: ${e.error.code} ${e.error.message}`); return e.data; };
const http = async (m, p, { token, json } = {}) => {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${p}`, { method: m, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${t.slice(0,400)}`);
  return JSON.parse(t);
};

await http('POST', '/auth/signup', { json: { email: EMAIL, password: PASSWORD, firstName: 'P', lastName: 'E' } });
const login = unwrap(await http('POST', '/auth/login', { json: { email: EMAIL, password: PASSWORD } }), 'login');
const org = unwrap(await http('POST', '/organizations', { token: login.accessToken, json: { name: `Probe Entry ${TS}`, type: 'company', system: 'NORMAL' } }), 'org');
const orgId = org.organization.id;
const sel = unwrap(await http('POST', '/auth/select-organization', { token: login.accessToken, json: { organizationId: orgId } }), 'select');
const t = sel.accessToken;

const year = new Date().getFullYear();
await http('POST', `/organizations/${orgId}/accounting-periods`, { token: t, json: { year, split: 'ANNUAL_ONLY' } });

const chart = unwrap(await http('GET', `/organizations/${orgId}/chart-of-accounts`, { token: t }), 'chart');
const list = chart.accounts ?? chart;
const has = (c) => list.some(a => a.code === c);
const p411 = has('411') ? '411' : has('41') ? '41' : '4';
const p701 = has('701') ? '701' : has('70') ? '70' : '7';
const aC = unwrap(await http('POST', `/organizations/${orgId}/chart-of-accounts`, { token: t, json: { parentCode: p411, code: p411 + '111', label: 'P Client' } }), 'aC');
const aV = unwrap(await http('POST', `/organizations/${orgId}/chart-of-accounts`, { token: t, json: { parentCode: p701, code: p701 + '111', label: 'P Vente' } }), 'aV');

console.log('[probe] POST /entries directly with accountCodes', aC.account.code, aV.account.code);
const today = new Date().toISOString().slice(0, 10);
const body = {
  journalCode: 'VE',
  entryDate: today,
  description: 'Probe direct entry',
  lines: [
    { accountCode: aC.account.code, debit: 100, credit: 0, description: 'D' },
    { accountCode: aV.account.code, debit: 0, credit: 100, description: 'C' },
  ],
};
try {
  const r = await http('POST', `/organizations/${orgId}/entries`, { token: t, json: body });
  console.log('[probe] ✅ createDraft OK:', JSON.stringify(r.data ?? r).slice(0, 200));
  const validated = await http('POST', `/organizations/${orgId}/entries/${r.data.entry.id}/validate`, { token: t, json: {} });
  console.log('[probe] ✅ validate OK:', JSON.stringify(validated.data ?? validated).slice(0, 200));
} catch (err) {
  console.error('[probe] ❌', err.message);
  process.exit(1);
}
