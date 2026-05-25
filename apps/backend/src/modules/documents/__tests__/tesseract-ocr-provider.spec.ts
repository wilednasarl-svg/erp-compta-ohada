import { TesseractOcrProvider } from '../services/tesseract-ocr-provider';

/**
 * Smoke tests for `TesseractOcrProvider`. The actual OCR call requires
 * the `tesseract.js` package to be installed locally; in environments
 * where it isn't (CI fast-lane, fresh checkouts), the provider returns
 * null without crashing. This file tests:
 *
 *   - The MIME guard rejects unsupported types BEFORE attempting to
 *     load tesseract (so the lack of the dep is irrelevant).
 *   - When tesseract is unavailable, `extract` returns null gracefully.
 *
 * The actual recognize-an-image test is left out of wave 2: it requires
 * a fixture image + a working tesseract install + several seconds of
 * wall-clock. A wave-3 integration test will cover that.
 */
describe('TesseractOcrProvider (smoke)', () => {
  it('returns null for unsupported MIME types (without loading tesseract)', async () => {
    const provider = new TesseractOcrProvider();
    await expect(
      provider.extract('/tmp/whatever.txt', 'application/octet-stream'),
    ).resolves.toBeNull();
    await expect(provider.extract('/tmp/whatever.txt', 'text/plain')).resolves.toBeNull();
    await expect(
      provider.extract('/tmp/whatever.docx', 'application/vnd.ms-excel'),
    ).resolves.toBeNull();
  });

  it('returns null when tesseract.js is not installed locally', async () => {
    const provider = new TesseractOcrProvider();
    // Image MIME is accepted by the guard, so the provider tries to
    // load tesseract.js. In environments where the dep is absent the
    // provider should swallow the load error and return null.
    let isInstalled = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('tesseract.js');
      isInstalled = true;
    } catch {
      isInstalled = false;
    }

    if (isInstalled) {
      // Dep is present — skip; a real recognize requires a fixture +
      // a working binary, which is wave-3 territory.
      return;
    }

    const result = await provider.extract('/tmp/no-such.png', 'image/png');
    expect(result).toBeNull();
  });
});
