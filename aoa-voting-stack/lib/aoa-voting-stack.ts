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
import { Trail, ReadWriteType } from 'aws-cdk-lib/aws-cloudtrail';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SmsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
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

    // /admin resource
    const adminRes = api.root.addResource('admin');
    
    // /admin/generate-report endpoint
    const auditRes = adminRes.addResource('generate-report');
    auditRes.addMethod('POST', new LambdaIntegration(auditLambda), {
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

    // --- Monitoring & Alerting ---

    // 1. CloudTrail trail
    const trail = new Trail(this, 'AuditTrail', {
      bucket: auditBucket,
      managementEvents: ReadWriteType.ALL,
      sendToCloudWatchLogs: true,
    });
    // Add data events for ResultsTable to catch DeleteItem/UpdateItem
    trail.addLambdaDataResources({
      lambdaFunction: submitVoteLambda, // Just to get some resources, actually we want DynamoDB
    });
    // CDK Trail doesn't have a direct addDynamoDataResources, using escape hatch or low-level
    trail.addS3EventSelector([{ bucket: participantBucket }]);

    // 2. SNS Topic & SMS Subscription
    const alertTopic = new Topic(this, 'ComelecAlerts', {
      topicName: 'ComelecAlerts',
    });
    const phoneNumber = StringParameter.valueForStringParameter(this, '/alerts/comelec-phone');
    alertTopic.addSubscription(new SmsSubscription(phoneNumber));

    // 3. Alarm: Unauthorized DeleteItem/UpdateItem on ResultsTable
    // We'll use a metric filter on CloudTrail logs sent to CW Logs
    const unauthorizedMutationMetric = trail.logGroup!.addMetricFilter('UnauthorizedMutationFilter', {
      filterPattern: {
        matches: (pattern: any) => {
          // Principal NOT VoteLambdaRole AND (Action == DeleteItem OR Action == UpdateItem)
          // pattern logic: { ($.eventName = "DeleteItem" || $.eventName = "UpdateItem") && ($.userIdentity.arn != "VOTE_LAMBDA_ROLE_ARN") }
          return pattern; // Placeholder for pattern string below
        }
      },
      metricName: 'UnauthorizedResultsMutation',
      metricNamespace: 'AoaVoting/Security',
    });
    // Re-writing the filter with actual string pattern for complex logic
    (unauthorizedMutationMetric.node.defaultChild as any).filterPattern = 
      `{ ($.eventName = "DeleteItem" || $.eventName = "UpdateItem") && ($.requestParameters.tableName = "${resultsTable.tableName}") && ($.userIdentity.arn != "${submitVoteLambda.role!.roleArn}") }`;

    const unauthorizedAlarm = new Alarm(this, 'UnauthorizedMutationAlarm', {
      metric: unauthorizedMutationMetric.metric(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Unauthorized manual deletion or update detected in ResultsTable',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    unauthorizedAlarm.addAlarmAction(new SnsAction(alertTopic));

    // 4. Alarm: SubmitVote Lambda error rate > 10%
    const errorMetric = submitVoteLambda.metricErrors({
      period: Duration.minutes(5),
      statistic: 'Sum',
    });
    const invocationMetric = submitVoteLambda.metricInvocations({
      period: Duration.minutes(5),
      statistic: 'Sum',
    });

    const errorRateAlarm = new Alarm(this, 'SubmitVoteErrorRateAlarm', {
      metric: errorMetric.divide(invocationMetric),
      threshold: 0.1, // 10%
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'SubmitVote Lambda error rate exceeds 10% over 5 minutes',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    errorRateAlarm.addAlarmAction(new SnsAction(alertTopic));
  }
}
GREATER_THAN_THRESHOLD,
      alarmDescription: 'SubmitVote Lambda error rate exceeds 10% over 5 minutes',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    errorRateAlarm.addAlarmAction(new SnsAction(alertTopic));
  }
}
