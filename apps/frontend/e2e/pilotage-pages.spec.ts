import { expect, test } from '@playwright/test';

/**
 * Smoke E2E des quatre pages de pilotage net-new (Budget, Fiscal CI,
 * Rentabilité, Trésorerie), jouées sur un dossier VIDE via le storageState
 * authentifié écrit par global-setup.
 *
 * Objectif : prouver le rendu bout-en-bout sur le vrai stack — la route monte,
 * l'auth + l'org sont prises en compte, et les échecs de fetch (dossier vide)
 * dégradent en états vides plutôt que de casser le rendu. Chaque page expose
 * son titre H1 inconditionnellement (header rendu avant le contenu).
 */
const PAGES: ReadonlyArray<{ route: string; heading: string }> = [
  { route: '/budget', heading: 'Budget vs Réalisé' },
  { route: '/fiscal', heading: 'Échéancier fiscal & social' },
  { route: '/dashboards/profitability', heading: 'Rentabilité par activité' },
  { route: '/dashboards/treasury', heading: 'Trésorerie & Cash' },
];

test.describe('Pages de pilotage — smoke (dossier vide)', () => {
  for (const { route, heading } of PAGES) {
    test(`${route} rend son titre et ne crashe pas`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto(route);

      // Le H1 est rendu inconditionnellement dans le header de la page.
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();

      // La coquille applicative est montée (navigation principale présente).
      await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();

      // Aucune exception JS non interceptée pendant le rendu.
      expect(errors, errors.join('\n')).toHaveLength(0);
    });
  }
});
