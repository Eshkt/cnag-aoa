import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { expressjwt as jwt } from 'express-jwt';
import jwksRsa from 'jwks-rsa';

const app = express();

// --- 1. ENV VAR CHECK ---
const REQUIRED_VARS = [
  'AWS_REGION',
  'AMPLIFY_AUTH_USERPOOL_ID',
  'HAS_VOTED_TABLE',
  'RESULTS_TABLE'
];

for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.error(`FATAL: Missing environment variable ${v}`);
  }
}

const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const USER_POOL_ID = process.env.AMPLIFY_AUTH_USERPOOL_ID;

// Middleware
app.use(helmet());
app.use(cors({
  origin: 'https://main.d23np9c7e29dad.amplifyapp.com',
  credentials: true
}));
app.use(express.json());

// --- 2. ROBUST JWT CHECK ---
const checkJwt = (req: any, res: any, next: any) => {
  if (!USER_POOL_ID) {
    console.error('ERROR: USER_POOL_ID is missing. Cannot verify JWT.');
    return res.status(500).json({ error: 'Auth configuration error on server' });
  }

  return jwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`
    }) as any,
    issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
    algorithms: ['RS256']
  })(req, res, next);
};

// --- ROUTES ---

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/vote', checkJwt, async (req: any, res) => {
    try {
        console.log('VOTE REQUEST RECEIVED:', JSON.stringify(req.body));
        // Placeholder logic - ensure we return 200 to test connectivity
        res.json({ message: 'vote recorded (placeholder)' });
    } catch (err: any) {
        console.error('VOTE ERROR:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
});

app.get('/status', async (req, res) => {
    try {
        res.json({ open: true, totalVotes: 0 });
    } catch (err: any) {
        console.error('STATUS ERROR:', err);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// --- 3. GLOBAL ERROR HANDLER ---
app.use((err: any, req: any, res: any, next: any) => {
  console.error('UNHANDLED EXPRESS ERROR:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

export { app };
