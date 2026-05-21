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
backend.apiFunction.addEnvironment('AMPLIFY_AUTH_USERPOOL_ID', 'ap-southeast-1_86dD9EBqw');


// Create API Gateway REST API
const userPool = backend.auth.resources.userPool;

// Use RestApi for better control over methods and authorizers
const api = new apigw.RestApi(backend.stack, 'VotingApi', {
  restApiName: 'VotingApi',
  deployOptions: {
    stageName: 'prod',
  },
  // Disable default CORS to avoid duplicates
});

const authorizer = new apigw.CognitoUserPoolsAuthorizer(backend.stack, 'VotingAuthorizer', {
  cognitoUserPools: [userPool],
});

// Helper to add resource with ANY and OPTIONS
const addResourceWithCors = (resource: apigw.IResource) => {
  // ANY method with Authorizer
  resource.addMethod('ANY', new apigw.LambdaIntegration(backend.apiFunction.resources.lambda), {
    authorizationType: apigw.AuthorizationType.COGNITO,
    authorizer: authorizer,
  });

  // OPTIONS method with NONE authorizer for preflight
  resource.addMethod('OPTIONS', new apigw.MockIntegration({
    integrationResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'method.response.header.Access-Control-Allow-Methods': "'GET,POST,OPTIONS'",
        'method.response.header.Access-Control-Allow-Origin': "'https://main.d23np9c7e29dad.amplifyapp.com'",
        'method.response.header.Access-Control-Allow-Credentials': "'true'",
      },
    }],
    passthroughBehavior: apigw.PassthroughBehavior.NEVER,
    requestTemplates: {
      "application/json": "{\"statusCode\": 200}"
    },
  }), {
    methodResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true,
        'method.response.header.Access-Control-Allow-Origin': true,
        'method.response.header.Access-Control-Allow-Credentials': true,
      },
    }],
  });
};

// Root /
addResourceWithCors(api.root);

// Proxy /{proxy+}
const proxy = api.root.addResource('{proxy+}');
addResourceWithCors(proxy);

// Expose API URL as custom output so frontend can read it
backend.addOutput({
  custom: {
    apiEndpoint: api.url,
  },
});
