import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { expressjwt as jwt } from 'express-jwt';
import jwksRsa from 'jwks-rsa';
import { createHmac, randomUUID } from 'crypto';

const app = express();

// Configuration from environment variables (wired in backend.ts)
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const USER_POOL_ID = process.env.AMPLIFY_AUTH_USERPOOL_ID;
const HAS_VOTED_TABLE = process.env.HAS_VOTED_TABLE;
const RESULTS_TABLE = process.env.RESULTS_TABLE;
const HMAC_SECRET_NAME = 'HMAC_SIGNING_KEY'; // Amplify Secret name

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Cognito JWT Verification Middleware
// Note: USER_POOL_ID will be automatically provided by Amplify Gen 2
const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`
  }) as any,
  issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
  algorithms: ['RS256']
});

// Admin Group Check Middleware
const checkAdmin = (req: any, res: any, next: any) => {
  const groups = req.auth['cognito:groups'] || [];
  if (!groups.includes('comelec-admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// --- ROUTES ---

// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// GET /status
app.get('/status', async (req, res) => {
    // Logic to fetch windowOpen from SSM and totalVotes from DynamoDB
    // For Gen 2, we might move SSM to Amplify Secrets or just use the SDK
    res.json({ open: true, totalVotes: 0 }); // Placeholder
});

// POST /vote
app.post('/vote', checkJwt, async (req: any, res) => {
    // Vote logic...
    res.json({ message: 'vote recorded' });
});

// GET /results
app.get('/results', async (req, res) => {
    // Results logic...
    res.json({ yesCount: 0, noCount: 0, totalVotes: 0 });
});

export { app };
