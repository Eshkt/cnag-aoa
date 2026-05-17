import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Table, Billing, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, ObjectLockRetention, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { UserPool, VerificationEmailStyle, CognitoUserPoolsAuthorizer } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration, AuthorizationType } from 'aws-cdk-lib/aws-apigateway';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { CfnOutput } from 'aws-cdk-lib';

export class AoaVotingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Audit Archive Bucket with Object Lock
    const auditBucket = new Bucket(this, 'AuditArchiveBucket', {
      bucketName: 'audit-archive-bucket',
      removalPolicy: RemovalPolicy.RETAIN,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectLockEnabled: true,
      objectLockDefaultRetention: ObjectLockRetention.compliance(Duration.days(365)),
    });

    // Participant List Bucket
    const participantBucket = new Bucket(this, 'ParticipantListBucket', {
      bucketName: 'participant-list-bucket',
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Table 1: HasVotedTable - tracks which voters have voted
    const hasVotedTable = new Table(this, 'HasVotedTable', {
      tableName: 'HasVotedTable',
      partitionKey: { name: 'voterId', type: AttributeType.STRING },
      billingMode: Billing.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Table 2: ResultsTable - stores votes with proposal and vote IDs
    const resultsTable = new Table(this, 'ResultsTable', {
      tableName: 'ResultsTable',
      partitionKey: { name: 'proposalId', type: AttributeType.STRING },
      sortKey: { name: 'voteId', type: AttributeType.STRING },
      billingMode: Billing.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Output table names for reference
    new CfnOutput(this, 'HasVotedTableName', { value: hasVotedTable.tableName });
    new CfnOutput(this, 'ResultsTableName', { value: resultsTable.tableName });

    // Voting window parameter
    new StringParameter(this, 'VotingWindowParameter', {
      parameterName: '/voting/window-open',
      stringValue: 'false',
      description: 'controls voting window. set to true to open, false to close.',
    });

    // Pre-signup Lambda Checker
    const preSignupLambda = new NodejsFunction(this, 'PreSignupChecker', {
      entry: 'src/pre-signup-checker/pre-signup-checker.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        PARTICIPANT_BUCKET: participantBucket.bucketName,
      },
    });

    participantBucket.grantRead(preSignupLambda);

    // Cognito User Pool
    const userPool = new UserPool(this, 'AoaUserPool', {
      userPoolName: 'aoa-voting-user-pool',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      lambdaTriggers: {
        preSignUp: preSignupLambda,
      },
    });

    const userPoolClient = userPool.addClient('AoaUserPoolClient', {
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
    });

    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }
}
e.ts',
      runtime: Runtime.NODEJS_20_X,
    });
    hasVotedTable.grantReadWriteData(submitVoteLambda);
    resultsTable.grantWriteData(submitVoteLambda);
    hmacSecret.grantRead(submitVoteLambda);

    // 2. Status Lambda
    const statusLambda = new NodejsFunction(this, 'StatusFunction', {
      entry: 'src/status/status.ts',
      runtime: Runtime.NODEJS_20_X,
    });
    hasVotedTable.grantReadWriteData(statusLambda); // Needs update item for atomic count

    // 3. Results Lambda
    const resultsLambda = new NodejsFunction(this, 'ResultsFunction', {
      entry: 'src/results/results.ts',
      runtime: Runtime.NODEJS_20_X,
    });
    resultsTable.grantReadData(resultsLambda);

    // API Gateway
    const api = new RestApi(this, 'AoaApi', {
      restApiName: 'AOA Voting API',
      deployOptions: {
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    const authorizer = new CognitoUserPoolsAuthorizer(this, 'AoaAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // /vote endpoint
    const voteRes = api.root.addResource('vote');
    voteRes.addMethod('POST', new LambdaIntegration(submitVoteLambda), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });

    // /status endpoint
    const statusRes = api.root.addResource('status');
    statusRes.addMethod('GET', new LambdaIntegration(statusLambda));

    // /results endpoint
    const resultsRes = api.root.addResource('results');
    resultsRes.addMethod('GET', new LambdaIntegration(resultsLambda), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });

    // Usage Plan for /vote throttling
    const plan = api.addUsagePlan('AoaUsagePlan', {
      name: 'Standard',
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
    });
    plan.addApiStage({ stage: api.deploymentStage });

    // WAF WebACL
    const waf = new CfnWebACL(this, 'AoaWaf', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'AoaWafMetric',
        sampledRequestsEnabled: true,
      },
      rules: [{
        name: 'RateLimit',
        priority: 1,
        action: { block: {} },
        statement: {
          rateBasedStatement: {
            limit: 100,
            aggregateKeyType: 'IP',
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'AoaRateLimitMetric',
          sampledRequestsEnabled: true,
        },
      }],
    });

    new CfnWebACLAssociation(this, 'AoaWafAssoc', {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
      webAclArn: waf.attrArn,
    });

    new CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}
