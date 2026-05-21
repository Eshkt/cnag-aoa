import { createServer, proxy } from 'aws-serverless-express';
import { app } from './app';

const server = createServer(app);

export const handler = async (event: any, context: any) => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://main.d23np9c7e29dad.amplifyapp.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
    'Access-Control-Allow-Credentials': 'true'
  };

  console.log('EVENT RECEIVED:', JSON.stringify(event));

  // STEP 3 - ADD OPTIONS HANDLER
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // STEP 4 - WRAP IN TRY CATCH
  try {
    // STEP 5 - PARSE BODY (Ensures logic doesn't crash on raw string)
    if (typeof event.body === 'string' && event.body.length > 0) {
      try {
        // We parse it here to ensure it is valid JSON before Express gets it
        JSON.parse(event.body); 
      } catch (e) {
        console.error('INVALID JSON BODY:', event.body);
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Invalid JSON' })
        };
      }
    }

    const response: any = await proxy(server, event, context, 'PROMISE').promise;
    
    // STEP 2 - FIX LAMBDA RESPONSE (Inject headers into every path)
    response.headers = { 
      ...response.headers, 
      ...CORS_HEADERS,
      // Ensure 'Content-Type' is set if missing
      'Content-Type': response.headers?.['Content-Type'] || 'application/json'
    };

    console.log('SUCCESSFUL RESPONSE:', JSON.stringify(response));
    return response;

  } catch (err: any) {
    console.error('SERVER CRASH:', err);
    
    // STEP 4 (Catch) - RETURN 500 WITH CORS HEADERS
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        error: 'Internal Server Error', 
        message: err.message || 'Server side bad' 
      })
    };
  }
};
