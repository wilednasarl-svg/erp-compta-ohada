import { Test, type TestingModule } from '@nestjs/testing';

import { PasswordService } from './password.service';

describe('PasswordService (BE-CRYPTO-01)', () => {
  let service: PasswordService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = moduleRef.get(PasswordService);
  });

  describe('hashPassword', () => {
    it('returns a non-empty string different from the plaintext', async () => {
      const plain = 'S3cur3-P@ssw0rd!';
      const hash = await service.hashPassword(plain);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
      expect(hash).not.toBe(plain);
    });

    it('produces an argon2id-formatted digest', async () => {
      const hash = await service.hashPassword('S3cur3-P@ssw0rd!');
      expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('produces different hashes for the same plaintext (random salt)', async () => {
      const first = await service.hashPassword('same-plaintext');
      const second = await service.hashPassword('same-plaintext');
      expect(first).not.toBe(second);
    });

    it('rejects an empty plaintext', async () => {
      await expect(service.hashPassword('')).rejects.toThrow(
        /plaintext must be a non-empty string/,
      );
    });
  });

  describe('verifyPassword', () => {
    it('returns true for a matching plaintext/hash pair', async () => {
      const plain = 'correct horse battery staple';
      const hash = await service.hashPassword(plain);

      await expect(service.verifyPassword(hash, plain)).resolves.toBe(true);
    });

    it('returns false for a non-matching plaintext', async () => {
      const hash = await service.hashPassword('correct horse battery staple');
      await expect(service.verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
    });

    it('returns false (without throwing) for a malformed hash', async () => {
      await expect(service.verifyPassword('not-an-argon2-hash', 'any')).resolves.toBe(false);
    });

    it('returns false (without throwing) for an empty hash or plaintext', async () => {
      await expect(service.verifyPassword('', 'plain')).resolves.toBe(false);

      const hash = await service.hashPassword('plain');
      await expect(service.verifyPassword(hash, '')).resolves.toBe(false);
    });
  });
});
