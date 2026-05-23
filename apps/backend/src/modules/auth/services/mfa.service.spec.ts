import { authenticator } from 'otplib';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuthEventContext, AuthEventsService } from '../../audit/services/auth-events.service';
import type { MfaConfigEntity } from '../entities/mfa-config.entity';
import type { UserEntity } from '../entities/user.entity';
import type { MfaConfigRepository } from '../repositories/mfa-config.repository';
import type { UserRepository } from '../repositories/user.repository';
import { TOTP_DIGITS, TOTP_PERIOD } from '../config/mfa.config';
import type { EncryptionService } from './encryption.service';
import type { PasswordService } from './password.service';
import { MfaService } from './mfa.service';

const CTX: AuthEventContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

function buildUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    email: 'yao@cabinet.ci',
    passwordHash: 'h',
    firstName: 'Yao',
    lastName: 'Konan',
    locale: 'fr-FR',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as UserEntity;
}

function buildConfig(overrides: Partial<MfaConfigEntity> = {}): MfaConfigEntity {
  return {
    id: 'mfa-1',
    userId: 'user-1',
    secretEncrypted: Buffer.from('cipher'),
    enabled: false,
    activatedAt: null,
    backupCodesHashed: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as MfaConfigEntity;
}

interface Harness {
  service: MfaService;
  findMfaByUserId: jest.Mock<Promise<MfaConfigEntity | null>, [string]>;
  upsertSecret: jest.Mock<Promise<MfaConfigEntity>, [{ userId: string; secretEncrypted: Buffer }]>;
  activateRow: jest.Mock<Promise<void>, [string, string[], Date]>;
  disableRow: jest.Mock<Promise<void>, [string]>;
  consumeBackupCode: jest.Mock<Promise<void>, [string, string[]]>;
  findUserById: jest.Mock<Promise<UserEntity | null>, [string]>;
  encrypt: jest.Mock<Promise<Buffer>, [Buffer | string]>;
  decrypt: jest.Mock<Promise<Buffer>, [Buffer | string]>;
  hashPassword: jest.Mock<Promise<string>, [string]>;
  verifyPassword: jest.Mock<Promise<boolean>, [string, string]>;
  recordEvent: jest.Mock<Promise<unknown>, [string, AuthEventContext, Record<string, unknown>?]>;
}

function buildHarness(): Harness {
  const findMfaByUserId = jest.fn<Promise<MfaConfigEntity | null>, [string]>();
  const upsertSecret = jest
    .fn<Promise<MfaConfigEntity>, [{ userId: string; secretEncrypted: Buffer }]>()
    .mockImplementation((input) => Promise.resolve(buildConfig({ userId: input.userId })));
  const activateRow = jest
    .fn<Promise<void>, [string, string[], Date]>()
    .mockResolvedValue(undefined);
  const disableRow = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
  const consumeBackupCode = jest
    .fn<Promise<void>, [string, string[]]>()
    .mockResolvedValue(undefined);
  const findUserById = jest.fn<Promise<UserEntity | null>, [string]>();
  const encrypt = jest
    .fn<Promise<Buffer>, [Buffer | string]>()
    .mockImplementation((value) =>
      Promise.resolve(typeof value === 'string' ? Buffer.from(value, 'utf8') : value),
    );
  const decrypt = jest
    .fn<Promise<Buffer>, [Buffer | string]>()
    .mockImplementation((value) =>
      Promise.resolve(typeof value === 'string' ? Buffer.from(value, 'utf8') : value),
    );
  const hashPassword = jest
    .fn<Promise<string>, [string]>()
    .mockImplementation((plain) => Promise.resolve(`hashed(${plain})`));
  const verifyPassword = jest.fn<Promise<boolean>, [string, string]>();
  const recordEvent = jest
    .fn<Promise<unknown>, [string, AuthEventContext, Record<string, unknown>?]>()
    .mockResolvedValue(null);

  const mfaConfigs = {
    findByUserId: findMfaByUserId,
    upsertSecret,
    activate: activateRow,
    disable: disableRow,
    consumeBackupCode,
  } as unknown as MfaConfigRepository;
  const users = { findActiveById: findUserById } as unknown as UserRepository;
  const encryption = { encrypt, decrypt } as unknown as EncryptionService;
  const passwords = { hashPassword, verifyPassword } as unknown as PasswordService;
  const audit = { record: recordEvent } as unknown as AuthEventsService;

  const service = new MfaService(mfaConfigs, users, encryption, passwords, audit);

  return {
    service,
    findMfaByUserId,
    upsertSecret,
    activateRow,
    disableRow,
    consumeBackupCode,
    findUserById,
    encrypt,
    decrypt,
    hashPassword,
    verifyPassword,
    recordEvent,
  };
}

describe('MfaService (BE-AUTH-MFA-01..04)', () => {
  describe('setup', () => {
    it('generates a fresh base32 secret, encrypts it, and returns an otpauth URI', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(null);
      h.findUserById.mockResolvedValue(buildUser({ email: 'yao@cabinet.ci' }));

      const result = await h.service.setup('user-1');

      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(result.otpauthUri).toContain('yao%40cabinet.ci');
      expect(result.otpauthUri).toContain(`digits=${TOTP_DIGITS}`);
      expect(result.otpauthUri).toContain(`period=${TOTP_PERIOD}`);
      expect(result.otpauthUri).toContain(`issuer=${encodeURIComponent('ERP Compta')}`);

      expect(h.upsertSecret).toHaveBeenCalledTimes(1);
      // Encrypted blob persisted is the UTF-8 buffer of the plaintext
      // secret (the test EncryptionService is an identity mock).
      const persisted = h.upsertSecret.mock.calls[0][0];
      expect(persisted.secretEncrypted.toString('utf8')).toBe(result.secret);
    });

    it('rejects with AUTH_MFA_ALREADY_ENABLED when MFA is already on', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(buildConfig({ enabled: true }));

      await expect(h.service.setup('user-1')).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_MFA_ALREADY_ENABLED,
      });
    });
  });

  describe('activate', () => {
    it('happy path: confirms a valid TOTP code, returns 10 backup codes, emits auth.mfa_enabled', async () => {
      const h = buildHarness();
      const secret = authenticator.generateSecret();
      h.findMfaByUserId.mockResolvedValue(
        buildConfig({ secretEncrypted: Buffer.from(secret, 'utf8') }),
      );
      const currentCode = authenticator.generate(secret);

      const result = await h.service.activate('user-1', { code: currentCode }, CTX);

      expect(result.backupCodes).toHaveLength(10);
      for (const code of result.backupCodes) {
        expect(code).toMatch(/^[A-Z2-7]{8}$/);
      }
      // Each backup code stored as an argon2id hash via PasswordService.
      expect(h.activateRow).toHaveBeenCalledTimes(1);
      const [_userId, hashed] = h.activateRow.mock.calls[0];
      expect(hashed).toHaveLength(10);
      for (const code of result.backupCodes) {
        expect(hashed).toContain(`hashed(${code})`);
      }
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.mfa_enabled');
    });

    it('rejects with AUTH_MFA_INVALID_CODE on a wrong code + emits auth.mfa_verification_failed', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(
        buildConfig({ secretEncrypted: Buffer.from('JBSWY3DPEHPK3PXP', 'utf8') }),
      );

      await expect(h.service.activate('user-1', { code: '000000' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_MFA_INVALID_CODE,
      });
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.mfa_verification_failed');
      expect(h.activateRow).not.toHaveBeenCalled();
    });

    it('rejects with AUTH_MFA_NOT_ENROLLED when no row exists', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(null);

      await expect(h.service.activate('user-1', { code: '000000' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_MFA_NOT_ENROLLED,
      });
    });

    it('rejects with AUTH_MFA_ALREADY_ENABLED when row is already activated', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(buildConfig({ enabled: true }));

      await expect(h.service.activate('user-1', { code: '000000' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_MFA_ALREADY_ENABLED,
      });
    });

    it('rejects when the encrypted secret cannot be decrypted (tampered ciphertext)', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(
        buildConfig({ secretEncrypted: Buffer.from('tampered', 'utf8') }),
      );
      h.decrypt.mockRejectedValue(new Error('GCM tag mismatch'));

      await expect(h.service.activate('user-1', { code: '000000' }, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_MFA_INVALID_CODE,
      });
    });
  });

  describe('disable', () => {
    it('disables MFA + emits auth.mfa_disabled', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(buildConfig({ enabled: true }));

      await h.service.disable('user-1', CTX);

      expect(h.disableRow).toHaveBeenCalledWith('user-1');
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.mfa_disabled');
    });

    it('rejects with AUTH_MFA_NOT_ENROLLED when MFA is not on', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(buildConfig({ enabled: false }));

      await expect(h.service.disable('user-1', CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_MFA_NOT_ENROLLED,
      });
    });
  });

  describe('verifyLoginChallenge', () => {
    it('accepts a valid TOTP code (no audit on success)', async () => {
      const h = buildHarness();
      const secret = authenticator.generateSecret();
      h.findMfaByUserId.mockResolvedValue(
        buildConfig({ enabled: true, secretEncrypted: Buffer.from(secret, 'utf8') }),
      );
      const code = authenticator.generate(secret);

      await expect(h.service.verifyLoginChallenge('user-1', code, CTX)).resolves.toBeUndefined();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('rejects with AUTH_MFA_INVALID_CODE on a stale TOTP + emits auth.mfa_verification_failed', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(
        buildConfig({ enabled: true, secretEncrypted: Buffer.from('JBSWY3DPEHPK3PXP', 'utf8') }),
      );

      await expect(h.service.verifyLoginChallenge('user-1', '000000', CTX)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_MFA_INVALID_CODE,
      });
      expect(h.recordEvent.mock.calls[0][0]).toBe('auth.mfa_verification_failed');
    });

    it('consumes a backup code on match: shrinks the array, no double-use', async () => {
      const h = buildHarness();
      const stored = ['hash-1', 'hash-2', 'hash-3'];
      h.findMfaByUserId.mockResolvedValue(
        buildConfig({ enabled: true, backupCodesHashed: stored }),
      );
      h.verifyPassword.mockImplementation((hash) => Promise.resolve(hash === 'hash-2'));

      await h.service.verifyLoginChallenge('user-1', 'ABCDEFGH', CTX);

      expect(h.consumeBackupCode).toHaveBeenCalledWith('user-1', ['hash-1', 'hash-3']);
    });

    it('rejects with AUTH_MFA_INVALID_CODE when no backup code matches', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(
        buildConfig({ enabled: true, backupCodesHashed: ['h1', 'h2'] }),
      );
      h.verifyPassword.mockResolvedValue(false);

      await expect(h.service.verifyLoginChallenge('user-1', 'ABCDEFGH', CTX)).rejects.toMatchObject(
        { code: ERROR_CODES.AUTH_MFA_INVALID_CODE },
      );
      expect(h.consumeBackupCode).not.toHaveBeenCalled();
    });

    it('rejects with AUTH_MFA_INVALID_CODE when the user is not actually MFA-enabled (stale challenge)', async () => {
      const h = buildHarness();
      h.findMfaByUserId.mockResolvedValue(buildConfig({ enabled: false }));

      await expect(h.service.verifyLoginChallenge('user-1', '123456', CTX)).rejects.toBeInstanceOf(
        AppException,
      );
    });
  });
});
