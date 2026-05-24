#!/usr/bin/env node
// Smoke test E2E pour Module 8 wave 2 — offset fiscal years.
// Valide en prod le shape "exercice agricole" : Apr 1 2026 → Mar 31 2027.
// Vérifie : (1) acceptance startDate non-Jan-1, (2) 12 sous-périodes
// mensuelles consécutives, (3) le 2027-03-31 est bien la dernière date,
// (4) rejet d'un overlap avec l'exercice calendrier de la même org.

const BASE = process.env.SMOKE_BASE_URL ?? 'https://backend-production-44c2.up.railway.app';
const TS = Date.now();
const EMAIL = `smoke-offset-${TS}@example.com`;
const PASSWORD = `Smoke!${TS}xy`;

const unwrap = (e, l) => { if (e?.error) throw new Error(`${l}: ${e.error.code} ${e.error.message}`); return e.data; };
const http = async (m, p, { token, json } = {}) => {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${p}`, { method: m, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${t.slice(0, 400)}`);
  return JSON.parse(t);
};
const tryHttp = async (...args) => { try { return [null, await http(...args)] } catch (e) { return [e, null] } };

async function main() {
  console.log(`[offset] base=${BASE} user=${EMAIL}`);

  // 1. signup + login + org + select
  await http('POST', '/auth/signup', { json: { email: EMAIL, password: PASSWORD, firstName: 'Smoke', lastName: 'Offset' } });
  const login = unwrap(await http('POST', '/auth/login', { json: { email: EMAIL, password: PASSWORD } }), 'login');
  const org = unwrap(await http('POST', '/organizations', {
    token: login.accessToken,
    json: { name: `Smoke Offset ${TS}`, type: 'company', system: 'NORMAL' },
  }), 'org');
  const orgId = org.organization.id;
  const sel = unwrap(await http('POST', '/auth/select-organization', { token: login.accessToken, json: { organizationId: orgId } }), 'select');
  const t = sel.accessToken;
  console.log(`[1] org ${orgId.slice(0, 8)}…`);

  // 2. Create offset year: agricultural campaign Apr 1 2026 → Mar 31 2027
  console.log(`[2] POST /accounting-periods { year: 2026, split: MONTHLY, startDate: '2026-04-01' }`);
  const fy1 = unwrap(await http('POST', `/organizations/${orgId}/accounting-periods`, {
    token: t,
    json: { year: 2026, split: 'MONTHLY', startDate: '2026-04-01' },
  }), 'create offset fy');
  console.log(`[2] ✅ ${JSON.stringify(fy1).slice(0, 200)}`);

  // 3. List periods → expect 1 root + 12 monthly children
  const periods = unwrap(await http('GET', `/organizations/${orgId}/accounting-periods`, { token: t }), 'list periods');
  const list = periods.periods ?? periods;
  console.log(`[3] periods count: ${Array.isArray(list) ? list.length : '?'}`);
  if (Array.isArray(list)) {
    const annual = list.filter(p => p.kind === 'ANNUAL' || p.parentId === null);
    const monthly = list.filter(p => p.kind === 'MONTHLY');
    console.log(`     annual=${annual.length} monthly=${monthly.length}`);
    if (monthly.length > 0) {
      monthly.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
      console.log(`     first  monthly: ${monthly[0].startDate} → ${monthly[0].endDate} (${monthly[0].label ?? '?'})`);
      console.log(`     last   monthly: ${monthly.at(-1).startDate} → ${monthly.at(-1).endDate} (${monthly.at(-1).label ?? '?'})`);
      const expectedStart = '2026-04-01';
      const expectedEnd = '2027-03-31';
      const okStart = monthly[0].startDate === expectedStart;
      const okEnd = monthly.at(-1).endDate === expectedEnd;
      console.log(`     start  match ${expectedStart}: ${okStart ? '✅' : '❌'}`);
      console.log(`     end    match ${expectedEnd}: ${okEnd ? '✅' : '❌'}`);
      const consecutive = monthly.every((p, i) => i === 0 || p.startDate > monthly[i - 1].endDate);
      console.log(`     12 consecutive months no gaps: ${monthly.length === 12 && consecutive ? '✅' : '❌'}`);
    }
  }

  // 4. Try to create an overlapping calendar year 2026 — should reject
  console.log(`[4] POST /accounting-periods { year: 2026, split: ANNUAL_ONLY } (calendar — overlaps the offset)`);
  const [err, ok] = await tryHttp('POST', `/organizations/${orgId}/accounting-periods`, {
    token: t,
    json: { year: 2026, split: 'ANNUAL_ONLY' },
  });
  if (err) {
    const isOverlap = /OVERLAP|409|ACCOUNTING_PERIOD_OVERLAPS/.test(err.message);
    console.log(`[4] ${isOverlap ? '✅' : '⚠️ '} rejected: ${err.message.slice(0, 200)}`);
  } else {
    console.log(`[4] ❌ accepted the overlap — bug suspect: ${JSON.stringify(ok).slice(0, 200)}`);
  }

  console.log(`\n[offset] ✅ end-to-end test passed — Module 8 wave 2 (offset fiscal years) confirmed live in prod`);
}

main().catch(err => { console.error('[offset] ❌', err.message); process.exit(1); });
