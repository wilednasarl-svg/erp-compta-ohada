import { type ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../../config/configuration';
import { EncryptionService } from './encryption.service';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 11).toString('base64');

function buildService(base64Key: string = KEY_A): EncryptionService {
  const configService = {
    get: jest.fn((path: string) => {
      if (path === 'mfa') {
        return { encryptionKey: base64Key };
      }
      return undefined;
    }),
  } as unknown as ConfigService<AppConfig, true>;
  return new EncryptionService(configService);
}

describe('EncryptionService (BE-CRYPTO-02)', () => {
  describe('constructor', () => {
    it('rejects a key that does not decode to 32 bytes', () => {
      const shortKey = Buffer.alloc(16, 1).toString('base64');
      expect(() => buildService(shortKey)).toThrow(/must decode to 32 bytes/);
    });

    it('accepts a valid base64-encoded 32-byte key', () => {
      expect(() => buildService()).not.toThrow();
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('decrypts back to the same UTF-8 string', async () => {
      const service = buildService();
      const plaintext = 'JBSWY3DPEHPK3PXP'; // typical base32 TOTP secret
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('decrypts back to the same raw Buffer', async () => {
      const service = buildService();
      const plaintext = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x7f, 0x80]);
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('handles empty plaintext (0-byte payload)', async () => {
      const service = buildService();
      const encrypted = await service.encrypt('');
      // Still carries iv (12) + tag (16) = 28 bytes of envelope.
      expect(encrypted.length).toBe(28);
      const decrypted = await service.decrypt(encrypted);
      expect(decrypted.toString('utf8')).toBe('');
    });

    it('handles UTF-8 multi-byte plaintext', async () => {
      const service = buildService();
      const plaintext = 'café — 测试 — 🛡️';
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });
  });

  describe('non-determinism (fresh IV per call)', () => {
    it('produces different ciphertexts for the same plaintext on repeated encrypt calls', async () => {
      const service = buildService();
      const plaintext = 'same input';
      const first = await service.encrypt(plaintext);
      const second = await service.encrypt(plaintext);

      expect(first.equals(second)).toBe(false);
      // The first 12 bytes (IV) must differ — that's the GCM non-reuse contract.
      expect(first.subarray(0, 12).equals(second.subarray(0, 12))).toBe(false);

      // Yet both still decrypt to the same plaintext.
      expect((await service.decrypt(first)).toString('utf8')).toBe(plaintext);
      expect((await service.decrypt(second)).toString('utf8')).toBe(plaintext);
    });
  });

  describe('format', () => {
    it('returns [iv (12) || tag (16) || ciphertext (n)] — total length = 28 + plaintext.length', async () => {
      const service = buildService();
      const plaintext = Buffer.from('hello world', 'utf8'); // 11 bytes
      const encrypted = await service.encrypt(plaintext);
      expect(encrypted.length).toBe(12 + 16 + plaintext.length);
    });
  });

  describe('tamper / wrong-key resistance', () => {
    it('throws when the ciphertext byte is flipped', async () => {
      const service = buildService();
      const encrypted = await service.encrypt('JBSWY3DPEHPK3PXP');
      // Flip a byte inside the ciphertext (past iv+tag = 28).
      encrypted[encrypted.length - 1] ^= 0x01;
      await expect(service.decrypt(encrypted)).rejects.toThrow(/authentication failed/);
    });

    it('throws when the GCM auth tag is flipped', async () => {
      const service = buildService();
      const encrypted = await service.encrypt('payload');
      // Tag lives at bytes [12, 28).
      encrypted[20] ^= 0x01;
      await expect(service.decrypt(encrypted)).rejects.toThrow(/authentication failed/);
    });

    it('throws when the IV is flipped', async () => {
      const service = buildService();
      const encrypted = await service.encrypt('payload');
      encrypted[0] ^= 0x01;
      await expect(service.decrypt(encrypted)).rejects.toThrow(/authentication failed/);
    });

    it('throws when a different key is used for decryption', async () => {
      const writer = buildService(KEY_A);
      const reader = buildService(KEY_B);
      const encrypted = await writer.encrypt('top-secret-totp');
      await expect(reader.decrypt(encrypted)).rejects.toThrow(/authentication failed/);
    });

    it('throws when the input is shorter than iv + tag', async () => {
      const service = buildService();
      const tooShort = Buffer.alloc(20, 0);
      await expect(service.decrypt(tooShort)).rejects.toThrow(/too short/);
    });
  });
});
