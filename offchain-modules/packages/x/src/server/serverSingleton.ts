import cors from 'cors';
import express from 'express';
import { logger } from '../utils/logger';

export class ServerSingleton {
  private static instance: ServerSingleton;
  private server: express;

  private constructor() {
    this.server = express();
  }

  start(port: number): void {
    this.server.listen(port);
    this.server.use(cors());
    logger.info(`server handler started on ${port}  🚀`);
  }

  public getServer(): express {
    return this.server;
  }

  public static getInstance(): ServerSingleton {
    if (!ServerSingleton.instance) {
      ServerSingleton.instance = new ServerSingleton();
    }
    return ServerSingleton.instance;
  }
}
