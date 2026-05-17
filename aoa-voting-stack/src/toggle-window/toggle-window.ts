import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({});
const VOTING_WINDOW_PARAM = '/voting/window-open';

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  // 1. Defense-in-depth: check for comelec-admin group
  const groups = event.requestContext.authorizer?.claims?.['cognito:groups'] || '';
  if (!groups.includes('comelec-admin')) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'access denied' }),
    };
  }

  try {
    // 2. Get current value
    const getResp = await ssmClient.send(new GetParameterCommand({
      Name: VOTING_WINDOW_PARAM,
    }));
    const currentValue = getResp.Parameter?.Value === 'true';
    const newValue = !currentValue;

    // 3. Toggle value
    await ssmClient.send(new PutParameterCommand({
      Name: VOTING_WINDOW_PARAM,
      Value: newValue.toString(),
      Overwrite: true,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ windowOpen: newValue }),
    };
  } catch (err) {
    console.error('Failed to toggle voting window:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'failed to toggle window' }),
    };
  }
};
