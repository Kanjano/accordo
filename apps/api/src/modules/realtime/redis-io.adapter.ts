import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../../config/env.js';

/**
 * Socket.IO on `/ws` with the Redis adapter (SPEC §5.6): several API instances share rooms, and
 * the worker emits through the same channel. Browsers from other origins are refused at handshake.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...(options as ServerOptions),
      serveClient: false,
      path: '/ws',
      cors: { origin: [this.env.WEB_URL], credentials: true },
      // Cross-site WebSocket hijacking: the session cookie travels, so the Origin must be ours.
      allowRequest: (req, cb) => {
        const origin = req.headers.origin;
        cb(null, !origin || origin === this.env.WEB_URL);
      },
    });
    const pub = new Redis(this.env.REDIS_URL);
    const sub = pub.duplicate();
    this.clients.push(pub, sub);
    server.adapter(createAdapter(pub, sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    for (const c of this.clients) c.disconnect();
  }
}
