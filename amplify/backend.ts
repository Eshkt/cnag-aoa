import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.ts';
import { storage } from './storage/resource.ts';
import { apiFunction } from './functions/api/resource.ts';
import * as cdk from 'aws-cdk-lib';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';

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
}

// Add environment variables to Lambda
backend.apiFunction.addEnvironment('HAS_VOTED_TABLE', hasVotedTable.tableName);
backend.apiFunction.addEnvironment('RESULTS_TABLE', resultsTable.tableName);
backend.apiFunction.addEnvironment('WINDOW_PARAM', windowParam.parameterName);

// Create API Gateway REST API
const userPool = backend.auth.resources.userPool;
const api = new apigw.LambdaRestApi(backend.stack, 'VotingApi', {
  handler: backend.apiFunction.resources.lambda,
  proxy: true,
  defaultCorsPreflightOptions: {
    allowOrigins: apigw.Cors.ALL_ORIGINS,
    allowMethods: apigw.Cors.ALL_METHODS,
    allowHeaders: ['Content-Type', 'Authorization'],
  },
  defaultMethodOptions: {
    authorizationType: apigw.AuthorizationType.COGNITO,
    authorizer: new apigw.CognitoUserPoolsAuthorizer(backend.stack, 'VotingAuthorizer', {
      cognitoUserPools: [userPool],
    }),
  },
});

// Expose API URL as custom output so frontend can read it
backend.addOutput({
  custom: {
    apiEndpoint: api.url,
  },
});
