import { NullOcrProvider } from '../services/null-ocr-provider';

describe('NullOcrProvider', () => {
  it('always returns null', async () => {
    const provider = new NullOcrProvider();
    await expect(provider.extract('/tmp/anything.pdf', 'application/pdf')).resolves.toBeNull();
    await expect(provider.extract('/tmp/img.png', 'image/png')).resolves.toBeNull();
    await expect(provider.extract('/tmp/x.bin', 'application/octet-stream')).resolves.toBeNull();
  });
});
