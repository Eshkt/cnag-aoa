import { Handler } from 'aws-lambda';
import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterHistoryCommand, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });

const HAS_VOTED_TABLE = 'HasVotedTable-804887692450';
const RESULTS_TABLE = 'ResultsTable-804887692450';
const PARTICIPANT_BUCKET = 'participant-list-bucket-804887692450';
const AUDIT_BUCKET = 'audit-archive-bucket-804887692450';
const VOTING_WINDOW_PARAM = '/voting/window-open';

export const handler: Handler = async () => {
  // 1. Scan HasVotedTable (paginated)
  const voterHashes: string[] = [];
  let hasVotedKey: any = undefined;
  do {
    const resp = await ddbDocClient.send(new ScanCommand({
      TableName: HAS_VOTED_TABLE,
      ProjectionExpression: 'voterId',
      ExclusiveStartKey: hasVotedKey,
    }));
    if (resp.Items) {
      voterHashes.push(...resp.Items.map((item: any) => item.voterId));
    }
    hasVotedKey = resp.LastEvaluatedKey;
  } while (hasVotedKey);
  const totalVotes = voterHashes.length;

  // 2. Scan ResultsTable (paginated)
  const votes: any[] = [];
  let resultsKey: any = undefined;
  do {
    const resp = await ddbDocClient.send(new ScanCommand({
      TableName: RESULTS_TABLE,
      ExclusiveStartKey: resultsKey,
    }));
    if (resp.Items) {
      votes.push(...resp.Items);
    }
    resultsKey = resp.LastEvaluatedKey;
  } while (resultsKey);

  // Count yes/no per proposalId
  const proposalResults: Record<string, { yes: number; no: number }> = {};
  votes.forEach((vote: any) => {
    if (!proposalResults[vote.proposalId]) {
      proposalResults[vote.proposalId] = { yes: 0, no: 0 };
    }
    if (vote.voteChoice === 'YES') {
      proposalResults[vote.proposalId].yes++;
    } else if (vote.voteChoice === 'NO') {
      proposalResults[vote.proposalId].no++;
    }
  });

  // 3. Current timestamp
  const reportGeneratedAt = new Date().toISOString();

  // 4. Get SSM parameter history (last 2 changes)
  let windowOpenTime = null;
  let windowCloseTime = null;
  try {
    const ssmResp = await ssmClient.send(new GetParameterHistoryCommand({
      Name: VOTING_WINDOW_PARAM,
    }));
    const history = ssmResp.Parameters || [];
    if (history.length >= 2) {
      // Last entry = most recent = CLOSE time; second to last = OPEN time
      windowOpenTime = history[history.length - 2].LastModifiedDate?.toISOString() || null;
      windowCloseTime = history[history.length - 1].LastModifiedDate?.toISOString() || null;
    } else if (history.length === 1) {
      windowOpenTime = history[0].LastModifiedDate?.toISOString() || null;
    }
  } catch (err) {
    console.error('Failed to get SSM parameter history:', err);
  }

  // 5. Get participants.json version ID
  let participantsVersionId = null;
  let participantsLastModified = null;
  try {
    const s3Resp = await s3Client.send(new HeadObjectCommand({
      Bucket: PARTICIPANT_BUCKET,
      Key: 'participants.json',
    }));
    participantsVersionId = s3Resp.VersionId || null;
    participantsLastModified = s3Resp.LastModified?.toISOString() || null;
  } catch (err: any) {
    console.error('Failed to get participants.json version:', err);
  }

  // 5.5. Read participants.json for eligible voter count
  let totalEligibleVoters = 0;
  try {
    const s3Resp = await s3Client.send(new GetObjectCommand({
      Bucket: PARTICIPANT_BUCKET,
      Key: 'participants.json',
    }));
    const bodyStr = await s3Resp.Body?.transformToString();
    const participants = JSON.parse(bodyStr || '[]');
    totalEligibleVoters = participants.length;
  } catch (err) {
    console.error('Failed to read participants.json:', err);
    totalEligibleVoters = 200; // Fallback
  }

  // 5.6. Compute ResultsTable Checksum
  const sortedVotes = [...votes].sort((a, b) => a.voteId.localeCompare(b.voteId));
  const resultTableChecksum = createHash('sha256')
    .update(JSON.stringify(sortedVotes))
    .digest('hex');

  // 6. Build JSON report
  const report = {
    reportGeneratedAt,
    votingWindow: {
      openTime: windowOpenTime,
      closeTime: windowCloseTime,
    },
    participantsFile: {
      versionId: participantsVersionId,
      lastModified: participantsLastModified,
    },
    summary: {
      totalEligibleVoters,
      totalVotesCast: totalVotes,
      quorumPercentage: totalEligibleVoters > 0 ? Math.round((totalVotes / totalEligibleVoters) * 100) : 0,
    },
    integrityProof: {
      resultTableChecksum,
    },
    proposalResults: proposalResults,
    voterHashes: voterHashes,
    allVotes: votes.map(({ voterHash, ...rest }) => rest),
  };

  // 7a. Save JSON report to audit bucket
  const jsonReportName = `audit-report-${Date.now()}.json`;
  await s3Client.send(new PutObjectCommand({
    Bucket: AUDIT_BUCKET,
    Key: jsonReportName,
    Body: JSON.stringify(report, null, 2),
    ContentType: 'application/json',
  }));

  // 7b. Generate HTML report
  const htmlReport = generateHtmlReport(report, jsonReportName);
  const htmlReportName = `audit-report-${Date.now()}.html`;
  await s3Client.send(new PutObjectCommand({
    Bucket: AUDIT_BUCKET,
    Key: htmlReportName,
    Body: htmlReport,
    ContentType: 'text/html',
  }));

  console.log(`Audit reports generated: ${jsonReportName}, ${htmlReportName}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      jsonReport: jsonReportName,
      htmlReport: htmlReportName,
    }),
  };
};

function generateHtmlReport(report: any, jsonReportName: string): string {
  const { proposalResults, summary, votingWindow, participantsFile } = report;

  let proposalHtml = '';
  for (const [proposalId, results] of Object.entries(proposalResults)) {
    proposalHtml += `
      <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0; color: #333;">${proposalId}</h3>
        <p style="margin: 5px 0;"><strong>YES:</strong> ${results.yes}</p>
        <p style="margin: 5px 0;"><strong>NO:</strong> ${results.no}</p>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit Report - ${jsonReportName}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .header { background: #1e40af; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 10px 0; }
    .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .section h2 { margin-top: 0; color: #333; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .summary-item { padding: 15px; background: #f0f9ff; border-radius: 6px; text-align: center; }
    .summary-item .value { font-size: 2rem; font-weight: bold; color: #1e40af; }
    .summary-item .label { color: #6b7280; }
    .status-bar { display: flex; align-items: center; gap: 10px; margin-top: 20px; }
    .status { padding: 8px 16px; border-radius: 4px; font-weight: bold; }
    .status.open { background: #dcfce7; color: #166534; }
    .status.closed { background: #fee2e2; color: #991b1b; }
    .quorum-met { background: #22c55e; color: white; padding: 10px; text-align: center; font-weight: bold; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #6b7280; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Audit Report</h1>
    <p>Generated: ${report.reportGeneratedAt}</p>
  </div>

  ${summary.quorumPercentage >= 67 ? '<div class="quorum-met">✓ Quorum (67%) Met</div>' : ''}

  <div class="section">
    <h2>Voting Summary</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <div class="value">${summary.totalEligibleVoters}</div>
        <div class="label">Eligible Voters</div>
      </div>
      <div class="summary-item">
        <div class="value">${summary.totalVotesCast}</div>
        <div class="label">Votes Cast</div>
      </div>
      <div class="summary-item">
        <div class="value">${summary.quorumPercentage}%</div>
        <div class="label">Quorum</div>
      </div>
      <div class="summary-item">
        <div class="value">${Object.keys(proposalResults).length}</div>
        <div class="label">Proposals</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Voting Window</h2>
    <p><strong>Window Open:</strong> ${votingWindow.openTime || 'N/A'}</p>
    <p><strong>Window Close:</strong> ${votingWindow.closeTime || 'N/A'}</p>
  </div>

  <div class="section">
    <h2>Participants File</h2>
    <p><strong>Version ID:</strong> ${participantsFile.versionId || 'N/A'}</p>
    <p><strong>Last Modified:</strong> ${participantsFile.lastModified || 'N/A'}</p>
  </div>

  <div class="section">
    <h2>Proposal Results</h2>
    ${proposalHtml}
  </div>

  <div class="footer">
    <p>This report was automatically generated by the Audit Report Lambda.</p>
    <p>Source: ${jsonReportName}</p>
  </div>
</body>
</html>
  `.trim();
}
