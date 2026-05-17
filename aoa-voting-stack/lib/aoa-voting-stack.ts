import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Table, Billing, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, ObjectLockRetention, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { UserPool, VerificationEmailStyle } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
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
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: {
        emailSubject: 'Verify your email for CNAG-CICS AOA Voting',
        emailBody: 'Thanks for signing up! Your verification code is {####}',
        emailStyle: VerificationEmailStyle.CODE,
      },
      lambdaTriggers: {
        preSignUp: preSignupLambda,
      },
    });

    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
  }
}
