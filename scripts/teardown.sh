#!/bin/bash
# Teardown script for AOA Voting System
# Preserves audit bucket while destroying compute and breaking ballot links.

set -e

AUDIT_BUCKET="audit-archive-bucket"
HMAC_SECRET_ID="hmac-signing-key"
STACK_NAME="AoaVotingStack"

echo "=== STARTING TEARDOWN ==="

# 1. Audit Verification
echo "Checking audit bucket completeness..."
FILE_COUNT=$(aws s3 ls "s3://${AUDIT_BUCKET}" --recursive | wc -l | xargs)

if [ "$FILE_COUNT" -lt 3 ]; then
  echo "ERROR: audit not complete (found $FILE_COUNT files, expected >= 3). teardown aborted."
  exit 1
fi
echo "Audit bucket verified ($FILE_COUNT files)."

# 2. Human Confirmation
echo ""
echo "WARNING: This will permanently delete the HMAC secret and destroy all infrastructure."
read -p "Type exactly 'I CONFIRM AUDIT IS SAVED' to continue: " CONFIRMATION

if [ "$CONFIRMATION" != "I CONFIRM AUDIT IS SAVED" ]; then
  echo "Confirmation failed. Exiting."
  exit 1
fi

# 3. Break ballot-identity link (Permanent)
echo "Force-deleting HMAC secret..."
aws secretsmanager delete-secret --secret-id "$HMAC_SECRET_ID" --force-delete-without-recovery

# 4. Destroy Infrastructure
echo "Destroying CDK stack..."
cd aoa-voting-stack
cdk destroy "$STACK_NAME" --force

# 5. Final message
echo ""
echo "=== TEARDOWN COMPLETE ==="
echo "Stack destroyed. Audit bucket preserved. Check AWS billing in 24h to confirm \$0."
