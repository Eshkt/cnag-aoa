import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Table, BillingMode, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, ObjectLockRetention, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { UserPool, VerificationEmailStyle } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration, AuthorizationType, CognitoUserPoolsAuthorizer } from 'aws-cdk-lib/aws-apigateway';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Trail, ReadWriteType } from 'aws-cdk-lib/aws-cloudtrail';
import { FilterPattern } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SmsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Alarm, ComparisonOperator, TreatMissingData, MathExpression } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { CfnOutput } from 'aws-cdk-lib';

export class AoaVotingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Audit Archive Bucket with Object Lock
    const auditBucket = new Bucket(this, 'AuditArchiveBucket', {
      bucketName: 'audit-archive-bucket-804887692450',
      removalPolicy: RemovalPolicy.RETAIN,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectLockEnabled: true,
      objectLockDefaultRetention: ObjectLockRetention.compliance(Duration.days(365)),
    });

    // Participant List Bucket
    const participantBucket = new Bucket(this, 'ParticipantListBucket', {
      bucketName: 'participant-list-bucket-804887692450',
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Table 1: HasVotedTable - tracks which voters have voted
    const hasVotedTable = new Table(this, 'HasVotedTable', {
      tableName: 'HasVotedTable-804887692450',
      partitionKey: { name: 'voterId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Table 2: ResultsTable - stores votes with proposal and vote IDs
    const resultsTable = new Table(this, 'ResultsTable', {
      tableName: 'ResultsTable-804887692450',
      partitionKey: { name: 'proposalId', type: AttributeType.STRING },
      sortKey: { name: 'voteId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Voting window parameter
    const windowParam = new StringParameter(this, 'VotingWindowParameter', {
      parameterName: '/voting/window-open',
      stringValue: 'false',
      description: 'controls voting window. set to true to open, false to close.',
    });

    // HMAC Secret
    const hmacSecret = Secret.fromSecretNameV2(this, 'HmacSecret', 'hmac-signing-key-804887692450');

    // Lambdas
    const preSignupLambda = new NodejsFunction(this, 'PreSignupChecker', {
      entry: 'src/pre-signup-checker/pre-signup-checker.ts',
      runtime: Runtime.NODEJS_20_X,
      environment: { PARTICIPANT_BUCKET: participantBucket.bucketName },
    });
    participantBucket.grantRead(preSignupLambda);

    const submitVoteLambda = new NodejsFunction(this, 'SubmitVoteFunction', {
      entry: 'src/submit-vote/submit-vote.ts',
      runtime: Runtime.NODEJS_20_X,
    });
    hasVotedTable.grantReadWriteData(submitVoteLambda);
    resultsTable.grantWriteData(submitVoteLambda);
    hmacSecret.grantRead(submitVoteLambda);
    windowParam.grantRead(submitVoteLambda);

    const statusLambda = new NodejsFunction(this, 'StatusFunction', {
      entry: 'src/status/status.ts',
      runtime: Runtime.NODEJS_20_X,
    });
    hasVotedTable.grantReadWriteData(statusLambda);
    windowParam.grantRead(statusLambda);

    const resultsLambda = new NodejsFunction(this, 'ResultsFunction', {
      entry: 'src/results/results.ts',
      runtime: Runtime.NODEJS_20_X,
    });
    resultsTable.grantReadData(resultsLambda);

    const auditLambda = new NodejsFunction(this, 'AuditReportFunction', {
      entry: 'src/generate-audit-report/generate-audit-report.ts',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.minutes(1),
      environment: {
        PARTICIPANT_BUCKET: participantBucket.bucketName,
        AUDIT_BUCKET: auditBucket.bucketName,
      },
    });
    hasVotedTable.grantReadData(auditLambda);
    resultsTable.grantReadData(auditLambda);
    participantBucket.grantRead(auditLambda);
    auditBucket.grantReadWrite(auditLambda);

    const toggleWindowLambda = new NodejsFunction(this, 'ToggleWindowFunction', {
      entry: 'src/toggle-window/toggle-window.ts',
      runtime: Runtime.NODEJS_20_X,
    });
    windowParam.grantRead(toggleWindowLambda);
    // Needs write too
    const windowParamArn = `arn:aws:ssm:${this.region}:${this.account}:parameter/voting/window-open`;
    toggleWindowLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:PutParameter'],
      resources: [windowParamArn],
    }));

    // Cognito
    const userPool = new UserPool(this, 'AoaUserPool', {
      userPoolName: 'aoa-voting-user-pool',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 8, requireLowercase: true, requireUppercase: true, requireDigits: true },
      lambdaTriggers: { preSignUp: preSignupLambda },
    });
    const userPoolClient = userPool.addClient('AoaUserPoolClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      enableTokenRevocation: true,
    });
    // Cast to any to force enable admin auth flow if type is missing or use direct override
    (userPoolClient.node.defaultChild as any).explicitAuthFlows = ['ALLOW_USER_SRP_AUTH', 'ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'];

    // API Gateway
    const api = new RestApi(this, 'AoaApi', { restApiName: 'AOA Voting API' });
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'AoaAuthorizer', { cognitoUserPools: [userPool] });

    const voteRes = api.root.addResource('vote');
    voteRes.addMethod('POST', new LambdaIntegration(submitVoteLambda), { authorizer, authorizationType: AuthorizationType.COGNITO });

    const statusRes = api.root.addResource('status');
    statusRes.addMethod('GET', new LambdaIntegration(statusLambda));

    const resultsRes = api.root.addResource('results');
    resultsRes.addMethod('GET', new LambdaIntegration(resultsLambda), { authorizer, authorizationType: AuthorizationType.COGNITO });

    const adminRes = api.root.addResource('admin');
    adminRes.addResource('generate-report').addMethod('POST', new LambdaIntegration(auditLambda), { authorizer, authorizationType: AuthorizationType.COGNITO });
    adminRes.addResource('toggle-window').addMethod('POST', new LambdaIntegration(toggleWindowLambda), { authorizer, authorizationType: AuthorizationType.COGNITO });

    const plan = api.addUsagePlan('AoaUsagePlan', { throttle: { rateLimit: 10, burstLimit: 20 } });
    plan.addApiStage({ stage: api.deploymentStage });

    // WAF
    const waf = new CfnWebACL(this, 'AoaWaf', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'AoaWafMetric', sampledRequestsEnabled: true },
      rules: [{
        name: 'RateLimit',
        priority: 1,
        action: { block: {} },
        statement: { rateBasedStatement: { limit: 100, aggregateKeyType: 'IP' } },
        visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'AoaRateLimitMetric', sampledRequestsEnabled: true },
      }],
    });
    new CfnWebACLAssociation(this, 'AoaWafAssoc', {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
      webAclArn: waf.attrArn,
    });

    // Monitoring & Alerting
    const trail = new Trail(this, 'AuditTrail', { bucket: auditBucket, managementEvents: ReadWriteType.ALL, sendToCloudWatchLogs: true });
    const alertTopic = new Topic(this, 'ComelecAlerts', { topicName: 'ComelecAlerts' });
    const phoneNumber = StringParameter.valueForStringParameter(this, '/alerts/comelec-phone');
    alertTopic.addSubscription(new SmsSubscription(phoneNumber));

    const unauthorizedMutationMetric = trail.logGroup!.addMetricFilter('UnauthorizedMutationFilter', {
      metricName: 'UnauthorizedResultsMutation',
      metricNamespace: 'AoaVoting/Security',
      filterPattern: FilterPattern.literal(`{ ($.eventName = "DeleteItem" || $.eventName = "UpdateItem") && ($.requestParameters.tableName = "${resultsTable.tableName}") && ($.userIdentity.arn != "${submitVoteLambda.role!.roleArn}") }`),
    });

    new Alarm(this, 'UnauthorizedMutationAlarm', {
      metric: unauthorizedMutationMetric.metric(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Unauthorized manual deletion or update detected in ResultsTable',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(alertTopic));

    const errorRate = new MathExpression({
      expression: 'errors / invocations',
      usingMetrics: {
        errors: submitVoteLambda.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
        invocations: submitVoteLambda.metricInvocations({ period: Duration.minutes(5), statistic: 'Sum' }),
      },
    });

    new Alarm(this, 'SubmitVoteErrorRateAlarm', {
      metric: errorRate,
      threshold: 0.1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'SubmitVote Lambda error rate exceeds 10% over 5 minutes',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(alertTopic));

    // Outputs
    new CfnOutput(this, 'HasVotedTableName', { value: hasVotedTable.tableName });
    new CfnOutput(this, 'ResultsTableName', { value: resultsTable.tableName });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}
