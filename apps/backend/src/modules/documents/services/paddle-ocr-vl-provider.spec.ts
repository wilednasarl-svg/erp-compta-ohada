import { PaddleOcrVlProvider, extractMarkdownFromData } from './paddle-ocr-vl-provider';

/**
 * Test seam: override the protected `fetchMarkdown` (the whole Gradio
 * network round-trip) so `extract`'s contract logic — MIME filtering,
 * confidence, empty handling, never-throw — is tested in isolation.
 */
class StubProvider extends PaddleOcrVlProvider {
  constructor(private readonly behaviour: () => Promise<string | null>) {
    super();
  }

  protected fetchMarkdown(): Promise<string | null> {
    return this.behaviour();
  }
}

describe('PaddleOcrVlProvider.extract', () => {
  const IMG = '/tmp/facture.png';

  it('returns null for an unsupported MIME type without calling the Space', async () => {
    let called = false;
    const provider = new StubProvider(() => {
      called = true;
      return Promise.resolve('x');
    });

    expect(await provider.extract(IMG, 'application/zip')).toBeNull();
    expect(called).toBe(false);
  });

  it('accepts PDF and delegates to the round-trip (rasterised there)', async () => {
    let called = false;
    const provider = new StubProvider(() => {
      called = true;
      return Promise.resolve('# from pdf');
    });

    const result = await provider.extract('/tmp/x.pdf', 'application/pdf');

    expect(called).toBe(true);
    expect(result?.text).toBe('# from pdf');
  });

  it('returns text + non-zero confidence on a successful parse', async () => {
    const md = '# Facture\nTotal TTC: 814 200';
    const provider = new StubProvider(() => Promise.resolve(md));

    const result = await provider.extract(IMG, 'image/png');

    expect(result?.text).toBe(md);
    expect(result?.confidence).toBeGreaterThan(0);
  });

  it('trims the Markdown and reports confidence 0 for an empty result', async () => {
    const provider = new StubProvider(() => Promise.resolve('   \n  '));
    expect(await provider.extract(IMG, 'image/png')).toEqual({ text: '', confidence: 0 });
  });

  it('returns null when the round-trip yields null (dep absent / bad output)', async () => {
    const provider = new StubProvider(() => Promise.resolve(null));
    expect(await provider.extract(IMG, 'image/png')).toBeNull();
  });

  it('never throws — a Space error becomes null', async () => {
    const provider = new StubProvider(() => Promise.reject(new Error('ZeroGPU quota exceeded')));
    expect(await provider.extract(IMG, 'image/png')).toBeNull();
  });
});

describe('extractMarkdownFromData', () => {
  it('prefers the raw Markdown at index 2', () => {
    expect(extractMarkdownFromData(['preview', '<html>', '# raw'])).toBe('# raw');
  });

  it('falls back to the preview at index 0 when index 2 is absent', () => {
    expect(extractMarkdownFromData(['# preview', '<html>'])).toBe('# preview');
  });

  it('unwraps a { value } component payload', () => {
    expect(extractMarkdownFromData([{ value: '# wrapped' }])).toBe('# wrapped');
  });

  it('returns null when data is not an array', () => {
    expect(extractMarkdownFromData({ unexpected: true })).toBeNull();
    expect(extractMarkdownFromData(null)).toBeNull();
  });
});
