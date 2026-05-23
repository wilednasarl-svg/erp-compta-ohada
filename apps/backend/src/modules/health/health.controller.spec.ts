import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { HealthController } from './health.controller';

function buildDataSource(query: jest.Mock): DataSource {
  return { query } as unknown as DataSource;
}

describe('HealthController', () => {
  describe('checkDb', () => {
    it('returns the raw `{ ok: true }` payload so the global interceptor envelopes it once', async () => {
      const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
      const controller = new HealthController(buildDataSource(query));

      const result = await controller.checkDb();

      // Critical: NO outer `{ data, error }` here. That wrapping is the
      // ResponseEnvelopeInterceptor's job. Wrapping twice was the
      // projet-ferme-2gd bug.
      expect(result).toEqual({ ok: true });
      expect(query).toHaveBeenCalledWith('SELECT 1');
    });

    it('throws ServiceUnavailableException with the underlying error message when SELECT 1 fails', async () => {
      const query = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const controller = new HealthController(buildDataSource(query));

      await expect(controller.checkDb()).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(controller.checkDb()).rejects.toMatchObject({
        message: 'ECONNREFUSED',
      });
    });

    it('falls back to a generic message when the thrown value is not an Error instance', async () => {
      const query = jest.fn().mockRejectedValue('boom');
      const controller = new HealthController(buildDataSource(query));

      await expect(controller.checkDb()).rejects.toMatchObject({
        message: 'Unknown database error',
      });
    });
  });
});
