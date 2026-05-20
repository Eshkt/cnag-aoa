import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ScanCommand, QueryCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const RESULTS_TABLE = process.env.RESULTS_TABLE!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  // Defense-in-depth: check for comelec-admin group
  const groups = event.requestContext.authorizer?.claims?.['cognito:groups'] || '';
  if (!groups.includes('comelec-admin')) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'access denied' }),
    };
  }

  try {
    // Get all votes from ResultsTable
    const scanResp = await ddbDocClient.send(new ScanCommand({
      TableName: RESULTS_TABLE,
    }));

    const votes: any[] = scanResp.Items || [];

    // Count YES and NO
    let yesCount = 0;
    let noCount = 0;

    votes.forEach((vote: any) => {
      if (vote.voteChoice === 'YES') yesCount++;
      if (vote.voteChoice === 'NO') noCount++;
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        yesCount,
        noCount,
        totalVotes: votes.length,
      }),
    };
  } catch (err) {
    console.error('Failed to get results:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to retrieve results' }),
    };
  }
};
