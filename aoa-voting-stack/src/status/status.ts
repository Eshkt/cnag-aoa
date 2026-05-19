import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ScanCommand, DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const HAS_VOTED_TABLE = process.env.HAS_VOTED_TABLE;
const VOTING_WINDOW_PARAM = process.env.WINDOW_PARAM;

let cachedWindowOpen: boolean | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

export const handler: APIGatewayProxyHandler = async (): Promise<APIGatewayProxyResult> => {
  // Read voting window status from SSM (with 30s cache)
  const now = Date.now();
  if (cachedWindowOpen === null || (now - lastCacheTime) > CACHE_TTL) {
    try {
      const ssmResp = await ssmClient.send(new GetParameterCommand({
        Name: VOTING_WINDOW_PARAM,
        WithDecryption: true,
      }));
      cachedWindowOpen = ssmResp.Parameter?.Value === 'true';
      lastCacheTime = now;
    } catch (err) {
      console.error('Failed to check voting window:', err);
      // If fetch fails, use stale cache if available, else default to false
      cachedWindowOpen = cachedWindowOpen ?? false;
    }
  }

  // Get vote count from COUNTER item (atomic)
  let totalVotes = 0;
  try {
    const counterResp = await ddbDocClient.send(new UpdateCommand({
      TableName: HAS_VOTED_TABLE,
      Key: { voterId: 'COUNTER' },
      UpdateExpression: 'ADD voteCount :zero',
      ExpressionAttributeValues: { ':zero': 0 },
      ReturnValues: 'UPDATED_NEW',
    }));
    totalVotes = counterResp.Attributes?.voteCount || 0;
  } catch (err) {
    console.error('Failed to get vote count:', err);
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
    },
    body: JSON.stringify({ open: cachedWindowOpen, totalVotes }),
  };
};
