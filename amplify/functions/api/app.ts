import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { expressjwt as jwt } from 'express-jwt';
import jwksRsa from 'jwks-rsa';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand, 
  ScanCommand, 
  UpdateCommand 
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { createHmac } from 'crypto';

const app = express();
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const ssmClient = new SSMClient({});

// --- 1. ENV VARS ---
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const USER_POOL_ID = process.env.AMPLIFY_AUTH_USERPOOL_ID;
const HAS_VOTED_TABLE = process.env.HAS_VOTED_TABLE;
const RESULTS_TABLE = process.env.RESULTS_TABLE;
const WINDOW_PARAM = process.env.WINDOW_PARAM || '/voting/window-open';

// --- 2. CANDIDATES DATA ---
const CANDIDATES = [
  {
    position: 'President',
    candidates: [
      { id: 'pres-1', name: 'John Doe', party: 'Alliance', photo: 'https://via.placeholder.com/150' },
      { id: 'pres-2', name: 'Jane Smith', party: 'Independent', photo: 'https://via.placeholder.com/150' },
    ]
  },
  {
    position: 'Vice President',
    candidates: [
      { id: 'vp-1', name: 'Alice Wong', party: 'Alliance', photo: 'https://via.placeholder.com/150' },
      { id: 'vp-2', name: 'Bob Lim', party: 'Independent', photo: 'https://via.placeholder.com/150' },
    ]
  }
];

// --- 3. MIDDLEWARE ---
app.use(helmet());
app.use(cors());
app.use(express.json());

const checkJwt = (req: any, res: any, next: any) => {
  if (!USER_POOL_ID) return res.status(500).json({ error: 'Auth config missing' });
  return jwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true, rateLimit: true, jwksRequestsPerMinute: 5,
      jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`
    }) as any,
    issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
    algorithms: ['RS256']
  })(req, res, next);
};

const checkAdmin = (req: any, res: any, next: any) => {
  const groups = req.auth['cognito:groups'] || [];
  if (!groups.includes('comelec-admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// --- 4. VOTER ROUTES ---

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/candidates', checkJwt, (req, res) => res.json(CANDIDATES));

app.get('/vote-status', checkJwt, async (req: any, res) => {
  try {
    const studentNumber = req.auth['custom:studentNumber'];
    
    // Check if window is open
    const windowRes = await ssmClient.send(new GetParameterCommand({ Name: WINDOW_PARAM }));
    const isOpen = windowRes.Parameter?.Value === 'true';

    // Check if already voted
    const votedRes = await ddbDocClient.send(new GetCommand({
      TableName: HAS_VOTED_TABLE,
      Key: { voterId: studentNumber }
    }));

    res.json({
      isOpen,
      hasVoted: !!votedRes.Item,
      studentNumber,
      name: req.auth.name
    });
  } catch (err) {
    console.error('STATUS ERROR:', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.post('/submit-vote', checkJwt, async (req: any, res) => {
  try {
    const studentNumber = req.auth['custom:studentNumber'];
    const { selections } = req.body; // { 'President': 'pres-1', ... }

    // 1. Verify window
    const windowRes = await ssmClient.send(new GetParameterCommand({ Name: WINDOW_PARAM }));
    if (windowRes.Parameter?.Value !== 'true') {
      return res.status(403).json({ error: 'Voting is currently closed.' });
    }

    // 2. Atomic check-and-set hasVoted
    try {
      await ddbDocClient.send(new PutCommand({
        TableName: HAS_VOTED_TABLE,
        Item: { 
          voterId: studentNumber, 
          timestamp: new Date().toISOString(),
          // Hash for audit (not storing choices here for secrecy)
          voteHash: createHmac('sha256', 'secret').update(JSON.stringify(selections)).digest('hex')
        },
        ConditionExpression: 'attribute_not_exists(voterId)'
      }));
    } catch (e: any) {
      if (e.name === 'ConditionalCheckFailedException') {
        return res.status(400).json({ error: 'You have already voted.' });
      }
      throw e;
    }

    // 3. Record results (increments)
    // Note: In production, use DynamoDB TransactWrite or a SQS queue for high load
    for (const [position, candidateId] of Object.entries(selections)) {
      await ddbDocClient.send(new UpdateCommand({
        TableName: RESULTS_TABLE,
        Key: { proposalId: position, voteId: candidateId as string },
        UpdateExpression: 'ADD voteCount :inc',
        ExpressionAttributeValues: { ':inc': 1 }
      }));
    }

    res.json({ success: true, message: 'Vote recorded successfully' });
  } catch (err) {
    console.error('SUBMIT ERROR:', err);
    res.status(500).json({ error: 'Internal server error during submission' });
  }
});

// --- 5. ADMIN ROUTES ---

app.get('/admin/turnout', checkJwt, checkAdmin, async (req, res) => {
  try {
    // 1. Get total votes cast
    const votedRes = await ddbDocClient.send(new ScanCommand({
      TableName: HAS_VOTED_TABLE,
      Select: 'COUNT'
    }));

    // 2. Get window status
    const windowRes = await ssmClient.send(new GetParameterCommand({ Name: WINDOW_PARAM }));

    res.json({
      totalVoted: votedRes.Count || 0,
      totalEligible: 200, // Hardcoded per user spec
      isOpen: windowRes.Parameter?.Value === 'true'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch turnout' });
  }
});

app.get('/admin/results', checkJwt, checkAdmin, async (req, res) => {
  try {
    const results = await ddbDocClient.send(new ScanCommand({ TableName: RESULTS_TABLE }));
    
    // Group by position
    const grouped = results.Items?.reduce((acc: any, item: any) => {
      const pos = item.proposalId;
      if (!acc[pos]) acc[pos] = [];
      acc[pos].push({ name: item.voteId, votes: item.voteCount || 0 });
      return acc;
    }, {});

    res.json(grouped || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

app.get('/admin/voters', checkJwt, checkAdmin, async (req, res) => {
  try {
    const voters = await ddbDocClient.send(new ScanCommand({ TableName: HAS_VOTED_TABLE }));
    res.json(voters.Items || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch voters' });
  }
});

app.put('/admin/voting-window', checkJwt, checkAdmin, async (req, res) => {
  try {
    const { open } = req.body;
    await ssmClient.send(new PutParameterCommand({
      Name: WINDOW_PARAM,
      Value: open ? 'true' : 'false',
      Overwrite: true
    }));
    res.json({ success: true, isOpen: open });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update window' });
  }
});

// --- 6. ERROR HANDLER ---
app.use((err: any, req: any, res: any, next: any) => {
  console.error('API ERROR:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

export { app };
