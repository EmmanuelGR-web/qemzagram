import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/** Socket.IO con CORS restringido a nuestra web y tamaño máximo de mensaje acotado. */
export class SecureIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigin: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.allowedOrigin, methods: ['GET', 'POST'] },
      maxHttpBufferSize: 100_000,
    } as ServerOptions);
  }
}
