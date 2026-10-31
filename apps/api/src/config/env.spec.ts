import { parseEnv } from './env.js';

const valid = {
  WEB_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  MEILI_HOST: 'http://localhost:7700',
  MEILI_MASTER_KEY: 'dev_master_key_change_me_please',
  HANDOVER_CODE_PEPPER: 'test-pepper',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET_PUBLIC: 'media',
  S3_BUCKET_PRIVATE: 'private',
  S3_FORCE_PATH_STYLE: 'true',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:4000',
  DEVICE_COOKIE_SECRET: 'y'.repeat(32),
  EMAIL_FROM: 'Accordo <no-reply@accordo.local>',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
};

describe('parseEnv', () => {
  it('parses and coerces a valid environment', () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
    expect(env.GOOGLE_CLIENT_ID).toBe('');
  });

  it('blocks startup when a variable is missing', () => {
    const { DATABASE_URL: _, ...missing } = valid;
    expect(() => parseEnv(missing)).toThrow(/DATABASE_URL/);
  });

  it('rejects short secrets', () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
