import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.ts';
import { storage } from './storage/resource.ts';
import { apiFunction } from './functions/api/resource.ts';
import * as cdk from 'aws-cdk-lib';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as apigw from 'aws-cdk-lib/aws-apigateway';

/**
 * @see https://docs.amplify.aws/gen2/build-a-backend/
 */
const backend = defineBackend({
  auth,
  storage,
  apiFunction,
});

// Create DynamoDB Tables using CDK Escapes
const hasVotedTable = new ddb.Table(backend.stack, 'HasVotedTable', {
  partitionKey: { name: 'voterId', type: ddb.AttributeType.STRING },
  billingMode: ddb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

const resultsTable = new ddb.Table(backend.stack, 'ResultsTable', {
  partitionKey: { name: 'proposalId', type: ddb.AttributeType.STRING },
  sortKey: { name: 'voteId', type: ddb.AttributeType.STRING },
  billingMode: ddb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// Create SSM Parameter for Voting Window
const windowParam = new ssm.StringParameter(backend.stack, 'VotingWindowParam', {
    parameterName: '/voting/window-open',
    stringValue: 'false',
});

// Grant permissions to the API Lambda function
const lambdaRole = backend.apiFunction.resources.lambda.role;

if (lambdaRole) {
  hasVotedTable.grantReadWriteData(lambdaRole);
  resultsTable.grantReadWriteData(lambdaRole);
  windowParam.grantRead(lambdaRole);
  windowParam.grantWrite(lambdaRole);
  
  // Grant read access to the HMAC secret for session signing
  // Path pattern from previous turns: /amplify/d23np9c7e29dad/main/HMAC_SECRET
  // We'll grant broad access to the app's amplify path for flexibility
  const secretPolicy = new cdk.aws_iam.PolicyStatement({
    actions: ['ssm:GetParameter'],
    resources: [`arn:aws:ssm:${cdk.Stack.of(backend.stack).region}:${cdk.Stack.of(backend.stack).account}:parameter/amplify/d23np9c7e29dad/main/*`],
  });
  lambdaRole.addToPrincipalPolicy(secretPolicy);
}

// Add environment variables to Lambda
backend.apiFunction.addEnvironment('HAS_VOTED_TABLE', hasVotedTable.tableName);
backend.apiFunction.addEnvironment('RESULTS_TABLE', resultsTable.tableName);
backend.apiFunction.addEnvironment('WINDOW_PARAM', windowParam.parameterName);
backend.apiFunction.addEnvironment('HMAC_SECRET_PATH', '/amplify/d23np9c7e29dad/main/HMAC_SECRET');


// Create API Gateway REST API
// Use RestApi for total control. No default Cognito Auth.
const api = new apigw.RestApi(backend.stack, 'VotingApi', {
  restApiName: 'VotingApi',
  deployOptions: {
    stageName: 'prod',
  },
});

const lambdaIntegration = new apigw.LambdaIntegration(backend.apiFunction.resources.lambda);

const addRoutes = (resource: apigw.IResource) => {
  // All methods are public at the Gateway level. 
  // Session validation happens inside the Lambda.
  resource.addMethod('ANY', lambdaIntegration, {
    authorizationType: apigw.AuthorizationType.NONE,
  });

  resource.addMethod('OPTIONS', lambdaIntegration, {
    authorizationType: apigw.AuthorizationType.NONE,
  });
};

// Apply routes to / and /{proxy+}
addRoutes(api.root);
const proxy = api.root.addResource('{proxy+}');
addRoutes(proxy);

// Expose API URL as custom output
backend.addOutput({
  custom: {
    apiEndpoint: api.url,
  },
});
