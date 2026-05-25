// Bundle-size budgets enforced by CI (.github/workflows/ci.yml :: bundle-size).
//
// Next.js App Router emits hashed chunk filenames under .next/static/chunks/.
// Per-route page chunks live under `.next/static/chunks/app/<route>/page-*.js`
// — those are the deltas a route ships on top of the shared framework + app
// shell. Shared chunks (framework, main-app, vendor splits) sit at the root
// of `.next/static/chunks/` and load on every page.
//
// Budget: 200 kB gzip per critical surface. Crossing this threshold almost
// always means a heavy dependency was pulled into the shared bundle or a
// route stopped code-splitting properly — investigate before bumping.
module.exports = [
  {
    name: 'framework chunk (react, next runtime)',
    path: '.next/static/chunks/framework-*.js',
    limit: '200 kB',
    gzip: true,
  },
  {
    name: 'main app shell (loaded on every route)',
    path: '.next/static/chunks/main-app-*.js',
    limit: '200 kB',
    gzip: true,
  },
  {
    name: 'route /login (page chunk only, excludes shared)',
    path: '.next/static/chunks/app/login/page-*.js',
    limit: '200 kB',
    gzip: true,
  },
  {
    name: 'route /dashboard (page chunk only, excludes shared)',
    path: '.next/static/chunks/app/dashboard/page-*.js',
    limit: '200 kB',
    gzip: true,
  },
];
