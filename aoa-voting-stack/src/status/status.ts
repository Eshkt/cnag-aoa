import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ScanCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const ssmClient = new SSMClient({});
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const HAS_VOTED_TABLE = 'HasVotedTable';
const VOTING_WINDOW_PARAM = '/voting/window-open';

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

  // Count votes from HasVotedTable
  let totalVotes = 0;
  try {
    const scanResp = await ddbDocClient.send(new ScanCommand({
      TableName: HAS_VOTED_TABLE,
      Select: 'COUNT',
    }));
    totalVotes = scanResp.Count || 0;
  } catch (err) {
    console.error('Failed to count votes:', err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ open: windowOpen, totalVotes }),
  };
};
