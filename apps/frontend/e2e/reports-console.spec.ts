import { expect, test } from '@playwright/test';

/**
 * E2E navigateur du Report Console — personas 6.1→6.3 de
 * `src/app/reports/_console/ACCEPTANCE.md`, joués sur un dossier VIDE
 * (storageState authentifié écrit par global-setup). Couvre la navigation,
 * les presets, le câblage AC-V5 (validité avant génération), la génération,
 * la persistance des favoris et l'historique — bout en bout, vrai stack.
 */
test.describe('Report Console — parcours utilisateurs (ACCEPTANCE §6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports/console');
    await expect(page.getByRole('heading', { name: 'Console des états' })).toBeVisible();
  });

  test('6.2 dirigeant : preset trimestre, validité avant génération, génération', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: 'Balance générale' }).click();

    // AC-V5 : la validité reflète le dossier (vide) AVANT toute génération.
    await expect(page.getByText('Aucune écriture')).toBeVisible();

    // Champ période (le résumé d'une plage contient « → ») → preset sans saisie.
    await page.getByRole('button', { name: /→/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Ce trimestre' }).click();
    await dialog.getByRole('button', { name: 'Appliquer' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Générer' }).click();
    await expect(page.getByText(/État prêt/)).toBeVisible();
  });

  test('6.1 comptable : favori enregistré et persistant après rechargement', async ({ page }) => {
    await page.getByRole('button', { name: /Favoris/ }).click();
    await page.getByLabel('Nom du favori').fill('Bilan quotidien');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Bilan quotidien')).toBeVisible();

    // Persistance localStorage : recharger puis rouvrir le menu Favoris.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Console des états' })).toBeVisible();
    await page.getByRole('button', { name: /Favoris/ }).click();
    await expect(page.getByText('Bilan quotidien')).toBeVisible();
  });

  test('6.3 fiabilité : dossier vide signalé, génération tracée dans l’historique', async ({
    page,
  }) => {
    // Onglet Bilan (défaut) : la validité annonce un journal sans écriture.
    await expect(page.getByText('Aucune écriture')).toBeVisible();

    await page.getByRole('button', { name: 'Générer' }).click();
    await expect(page.getByText(/État prêt/)).toBeVisible();

    // Traçabilité : « Récent » liste la génération qui vient d'avoir lieu.
    await page.getByRole('button', { name: 'Récent' }).click();
    await expect(page.getByText(/généré en/)).toBeVisible();
  });
});
