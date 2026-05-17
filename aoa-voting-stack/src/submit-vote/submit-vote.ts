import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { createHmac } from 'crypto';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, GetCommand, DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ssmClient = new SSMClient({});
const secretsClient = new SecretsManagerClient({});
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const HAS_VOTED_TABLE = 'HasVotedTable';
const RESULTS_TABLE = 'ResultsTable';
const VOTING_WINDOW_PARAM = '/voting/window-open';
const HMAC_SECRET_NAME = 'hmac-signing-key';

let cachedHmacSecret: string | null = null;

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  // 1. Extract request body and JWT
  const body = JSON.parse(event.body || '{}');
  const { proposalId, voteChoice } = body;

  // Validation
  const proposalRegex = /^[a-zA-Z0-9-_]{1,64}$/;
  if (!proposalId || !proposalRegex.test(proposalId)) {
    return { statusCode: 400, body: 'invalid proposal' };
  }

  if (voteChoice !== 'YES' && voteChoice !== 'NO') {
    return { statusCode: 400, body: 'invalid vote choice' };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader) {
    return { statusCode: 401, body: 'missing authorization header' };
  }

  // Simple JWT decode (get payload without verification - Cognito verifies it first)
  const parts = authHeader.split('.');
  if (parts.length !== 3) {
    return { statusCode: 401, body: 'invalid token format' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
  } catch {
    return { statusCode: 401, body: 'invalid token' };
  }

  // 2. Extract userId from JWT "sub" field
  const userId = payload.sub;
  if (!userId) {
    return { statusCode: 401, body: 'missing user id' };
  }

  // 3. Get HMAC secret (from cache or Secrets Manager)
  if (!cachedHmacSecret) {
    try {
      const secretResp = await secretsClient.send(new GetSecretValueCommand({
        SecretId: HMAC_SECRET_NAME,
      }));
      cachedHmacSecret = secretResp.SecretString || secretResp.SecretBinary?.toString() || '';
    } catch (err) {
      console.error('Failed to get HMAC secret:', err);
      return { statusCode: 500, body: 'secret retrieval failed' };
    }
  }

  // 4. Hash userId with HMAC-SHA256
  const voterHash = createHmac('sha256', cachedHmacSecret)
    .update(userId)
    .digest('hex');

  // 5. Check voting window from SSM
  let windowOpen;
  try {
    const ssmResp = await ssmClient.send(new GetParameterCommand({
      Name: VOTING_WINDOW_PARAM,
      WithDecryption: true,
    }));
    windowOpen = ssmResp.Parameter?.Value === 'true';
  } catch (err) {
    console.error('Failed to check voting window:', err);
    return { statusCode: 500, body: 'window check failed' };
  }

  if (!windowOpen) {
    return { statusCode: 403, body: 'voting closed' };
  }

  // 6. Atomic Transaction: Mark as voted AND record vote
  const voteId = randomUUID();
  const timestamp = new Date().toISOString();

  try {
    await ddbDocClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: HAS_VOTED_TABLE,
            Item: { voterId: voterHash },
            ConditionExpression: 'attribute_not_exists(voterId)',
          },
        },
        {
          Put: {
            TableName: RESULTS_TABLE,
            Item: {
              proposalId,
              voteId,
              voteChoice,
              timestamp,
            },
          },
        },
        {
          Update: {
            TableName: HAS_VOTED_TABLE,
            Key: { voterId: 'COUNTER' },
            UpdateExpression: 'ADD voteCount :inc',
            ExpressionAttributeValues: { ':inc': 1 },
          },
        },
      ],
    }));
  } catch (err: any) {
    if (err.name === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons;
      if (reasons && reasons[0].Code === 'ConditionalCheckFailed') {
        return { statusCode: 409, body: 'already voted' };
      }
    }
    console.error('Transaction failed:', err);
    return { statusCode: 500, body: 'database error' };
  }

  // 7. Return success
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'vote recorded' }),
  };
};
