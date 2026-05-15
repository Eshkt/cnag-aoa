import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Table, Billing, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, ObjectLockRetention, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
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
  }
}
