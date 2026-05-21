import { createServer, proxy } from 'aws-serverless-express';
import { app } from './app';

const server = createServer(app);

export const handler = async (event: any, context: any) => {
  console.log('LAMBDA EVENT RECEIVED:', JSON.stringify(event));

  try {
    // 1. Ensure body is parsed if it's a string (AWS sometimes sends stringified JSON)
    if (typeof event.body === 'string' && event.body.length > 0) {
      try {
        event.body = JSON.parse(event.body);
      } catch (e) {
        console.warn('Could not parse event body as JSON', e);
      }
    }

    // 2. Proxy to Express
    const response = await proxy(server, event, context, 'PROMISE').promise;
    console.log('LAMBDA RESPONSE:', JSON.stringify(response));
    return response;

  } catch (err: any) {
    console.error('CRITICAL LAMBDA ERROR:', err);

    // 3. Return explicit error response shape
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*'
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: err.message || 'Unknown error',
        stack: err.stack
      })
    };
  }
};
