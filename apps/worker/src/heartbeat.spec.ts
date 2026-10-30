import type { Env } from './env.js';
import { HeartbeatProcessor, HeartbeatScheduler } from './heartbeat.js';

describe('heartbeat', () => {
  it('registers an idempotent job scheduler', async () => {
    const upsertJobScheduler = vi.fn();
    const env = { HEARTBEAT_EVERY_MS: 1000 } as Env;
    await new HeartbeatScheduler(env, { upsertJobScheduler } as never).onApplicationBootstrap();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'worker-heartbeat',
      { every: 1000 },
      { name: 'beat' },
    );
  });

  it('processes a beat', async () => {
    await expect(new HeartbeatProcessor().process()).resolves.toHaveProperty('at');
  });
});
