import express from 'express';
import helmet from 'helmet';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand, 
  ScanCommand, 
  UpdateCommand 
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';

const app = express();
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const ssmClient = new SSMClient({});

// --- 1. ENV VARS & CONFIG ---
const HAS_VOTED_TABLE = process.env.HAS_VOTED_TABLE;
const RESULTS_TABLE = process.env.RESULTS_TABLE;
const WINDOW_PARAM = process.env.WINDOW_PARAM || '/voting/window-open';
const HMAC_SECRET_PATH = process.env.HMAC_SECRET_PATH;

let CACHED_SECRET: string | null = null;
const ADMIN_EMAILS = [
    'admin@ust.edu.ph', 
    'comelec@ust.edu.ph', 
    'cnag.cics@ust.edu.ph', 
    'franky.parcon.cics@ust.edu.ph'
];

// In-memory store for Admin sessions
const ADMIN_SESSIONS = new Map<string, { email: string, exp: number }>();

async function getSecret() {
  if (CACHED_SECRET) return CACHED_SECRET;
  try {
    const res = await ssmClient.send(new GetParameterCommand({ 
        Name: HMAC_SECRET_PATH || '/amplify/d23np9c7e29dad/main/HMAC_SECRET',
        WithDecryption: true 
    }));
    CACHED_SECRET = res.Parameter?.Value || 'fallback-secret-for-dev';
    return CACHED_SECRET;
  } catch (e) {
    console.error('Failed to fetch secret from SSM:', e);
    return 'fallback-secret-for-dev';
  }
}

// --- 2. BALLOT DATA ---
const CANDIDATES = [
  {
    id: 'ratify-aoa',
    position: 'AOA Ratification',
    candidates: [
      { id: 'yes', name: 'I ratify the AOA', party: 'YES', photo: 'https://via.placeholder.com/150?text=YES' },
      { id: 'no', name: 'I do not ratify the AOA', party: 'NO', photo: 'https://via.placeholder.com/150?text=NO' },
    ]
  }
];

// --- 3. SESSION LOGIC ---
async function signToken(payload: any) {
  const secret = await getSecret();
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + (30 * 60 * 1000) })).toString('base64');
  const signature = createHmac('sha256', secret).update(data).digest('hex');
  return `${data}.${signature}`;
}

const checkSession = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No session' });

  const token = authHeader.split(' ')[1];
  
  // Check if it's an Admin Session Token first
  const adminSession = ADMIN_SESSIONS.get(token);
  if (adminSession) {
      if (Date.now() > adminSession.exp) {
          ADMIN_SESSIONS.delete(token);
          return res.status(401).json({ error: 'Admin session expired' });
      }
      req.voter = { email: adminSession.email, isAdmin: true };
      return next();
  }

  // Otherwise validate as a Voter JWT
  const [data, signature] = token.split('.');
  if (!data || !signature) return res.status(401).json({ error: 'Invalid token format' });

  try {
    const secret = await getSecret();
    const expectedSig = createHmac('sha256', secret).update(data).digest('hex');
    
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(Buffer.from(data, 'base64').toString());
    if (Date.now() > payload.exp) return res.status(401).json({ error: 'Session expired' });

    req.voter = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session validation failed' });
  }
};

const checkAdmin = (req: any, res: any, next: any) => {
  if (!req.voter?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

// --- 4. MIDDLEWARE ---
app.use(helmet());
app.use(express.json());

// --- 5. ROUTES ---

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- VOTER ROUTES ---

app.post('/begin-session', async (req, res) => {
  const { name, studentNumber, email } = req.body;
  
  if (!email?.toLowerCase().endsWith('@ust.edu.ph')) return res.status(400).json({ error: 'Only @ust.edu.ph emails allowed' });
  if (!name || !studentNumber) return res.status(400).json({ error: 'Missing name or student number' });

  try {
    const votedRes = await ddbDocClient.send(new GetCommand({
      TableName: HAS_VOTED_TABLE,
      Key: { voterId: studentNumber }
    }));

    if (votedRes.Item) return res.status(400).json({ error: 'Already voted' });

    const token = await signToken({ 
        name, 
        studentNumber, 
        email,
        isAdmin: ADMIN_EMAILS.includes(email.toLowerCase())
    });
    
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Failed to begin session' });
  }
});

app.get('/candidates', checkSession, (req, res) => res.json(CANDIDATES));

app.get('/vote-status', checkSession, async (req: any, res) => {
  try {
    const windowRes = await ssmClient.send(new GetParameterCommand({ Name: WINDOW_PARAM }));
    const isOpen = windowRes.Parameter?.Value === 'true';

    res.json({
      isOpen,
      hasVoted: false,
      studentNumber: req.voter.studentNumber,
      name: req.voter.name
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.post('/submit-vote', checkSession, async (req: any, res) => {
  try {
    const { selections } = req.body;
    const { studentNumber, name, email } = req.voter;

    const windowRes = await ssmClient.send(new GetParameterCommand({ Name: WINDOW_PARAM }));
    if (windowRes.Parameter?.Value !== 'true') return res.status(403).json({ error: 'Voting closed' });

    try {
      await ddbDocClient.send(new PutCommand({
        TableName: HAS_VOTED_TABLE,
        Item: { 
          voterId: studentNumber, 
          name,
          email,
          timestamp: new Date().toISOString(),
          selections: JSON.stringify(selections),
          voteHash: createHmac('sha256', 'audit-salt').update(JSON.stringify(selections)).digest('hex')
        },
        ConditionExpression: 'attribute_not_exists(voterId)'
      }));
    } catch (e: any) {
      if (e.name === 'ConditionalCheckFailedException') return res.status(400).json({ error: 'Already voted' });
      throw e;
    }

    for (const [positionId, candidateId] of Object.entries(selections)) {
      await ddbDocClient.send(new UpdateCommand({
        TableName: RESULTS_TABLE,
        Key: { proposalId: positionId, voteId: candidateId as string },
        UpdateExpression: 'ADD voteCount :inc',
        ExpressionAttributeValues: { ':inc': 1 }
      }));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('SUBMIT ERROR:', err);
    res.status(500).json({ error: 'Submission failed' });
  }
});

// --- ADMIN ROUTES ---

app.post('/admin/login', (req, res) => {
    const { email } = req.body;
    if (!email || !ADMIN_EMAILS.includes(email.toLowerCase())) {
        return res.status(403).json({ error: 'Access Denied' });
    }

    const token = randomUUID();
    ADMIN_SESSIONS.set(token, { email, exp: Date.now() + (60 * 60 * 1000) }); // 1 hour session

    res.json({ token, expiresIn: 3600 });
});

app.get('/admin/turnout', checkSession, checkAdmin, async (req, res) => {
  try {
    const votedRes = await ddbDocClient.send(new ScanCommand({ TableName: HAS_VOTED_TABLE, Select: 'COUNT' }));
    const windowRes = await ssmClient.send(new GetParameterCommand({ Name: WINDOW_PARAM }));
    res.json({ 
        totalVoted: votedRes.Count || 0, 
        totalEligible: 200, 
        windowOpen: windowRes.Parameter?.Value === 'true' 
    });
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

app.get('/admin/results', checkSession, checkAdmin, async (req, res) => {
  try {
    const results = await ddbDocClient.send(new ScanCommand({ TableName: RESULTS_TABLE }));
    
    // Group by position (specifically ratify-aoa)
    const yesItem = results.Items?.find(i => i.voteId === 'yes');
    const noItem = results.Items?.find(i => i.voteId === 'no');
    
    const yesCount = yesItem?.voteCount || 0;
    const noCount = noItem?.voteCount || 0;
    const total = yesCount + noCount;

    res.json({
        yes: { count: yesCount, percentage: total > 0 ? (yesCount / total) * 100 : 0 },
        no: { count: noCount, percentage: total > 0 ? (noCount / total) * 100 : 0 },
        total
    });
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

app.get('/admin/voters', checkSession, checkAdmin, async (req, res) => {
  try {
    const voters = await ddbDocClient.send(new ScanCommand({ TableName: HAS_VOTED_TABLE }));
    // Return sorted by timestamp descending
    const sorted = (voters.Items || []).sort((a: any, b: any) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

app.put('/admin/voting-window', checkSession, checkAdmin, async (req, res) => {
  try {
    const { open } = req.body;
    await ssmClient.send(new PutParameterCommand({ 
        Name: WINDOW_PARAM, 
        Value: open ? 'true' : 'false', 
        Overwrite: true 
    }));
    res.json({ success: true, windowOpen: open });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// --- 6. ERROR HANDLER ---
app.use((err: any, req: any, res: any, next: any) => {
  console.error('API ERROR:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

export { app };
