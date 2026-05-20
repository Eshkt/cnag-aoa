import { createServer, proxy } from 'aws-serverless-express';
import { app } from './app';

const server = createServer(app);

export const handler = (event: any, context: any) => {
  return proxy(server, event, context, 'PROMISE').promise;
};
