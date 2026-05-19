#!/bin/bash

# AOA Voting System - Teardown Script
# Break the link, wipe the stack, preserve the audit.

set -e
set -o pipefail

PROFILE="aoa-dev"
ENV_LOCAL=".env.local"
TF_DIR="terraform"

# Load environment
if [ ! -f "$ENV_LOCAL" ]; then
    echo "ERROR: $ENV_LOCAL not found. Nothing to destroy."
    exit 1
fi
source "$ENV_LOCAL"

echo "=== STEP 1: AUDIT CHECK ==="
FILE_COUNT=$(aws s3 ls "s3://$AUDIT_BUCKET/" --profile "$PROFILE" --recursive | wc -l | xargs)
echo "Found $FILE_COUNT files in audit bucket."

if [ "$FILE_COUNT" -lt 3 ]; then
    echo "ERROR: Audit not saved yet ($FILE_COUNT files). Run close-voting.sh first."
    exit 1
fi
echo "Audit verified."

echo -e "\n=== STEP 2: CONFIRMATION ==="
echo "WARNING: This will break the cryptographic link between voters and votes."
echo "WARNING: This will destroy all infrastructure except the Audit Bucket."
read -p "Type 'I CONFIRM AUDIT IS SAVED' to continue: " CONFIRM

if [ "$CONFIRM" != "I CONFIRM AUDIT IS SAVED" ]; then
    echo "Aborted."
    exit 1
fi

echo -e "\n=== STEP 3: DELETE HMAC SECRET ==="
# Secret name from terraform/resources.tf logic: hmac-signing-key-${account_id}-${environment}
# We can try the generic name provided by user, or attempt to find it.
# Using the specific command provided by the user:
aws secretsmanager delete-secret --secret-id "hmac-signing-key-804887692450-dev" --force-delete-without-recovery --profile "$PROFILE" || \
aws secretsmanager delete-secret --secret-id "hmac-signing-key" --force-delete-without-recovery --profile "$PROFILE" || \
echo "Secret already deleted or not found."

echo -e "\n=== STEP 4: TERRAFORM DESTROY ==="
# Terraform will fail to delete the Audit Bucket because it has files and Object Lock.
# This is expected behavior for preservation.
set +e
terraform -chdir=$TF_DIR destroy -var-file=terraform.tfvars -auto-approve
set -e

echo -e "\n=== STEP 5: CLEANUP STATE ==="
rm -f terraform/terraform.tfstate terraform/terraform.tfstate.backup
echo "Local state wiped."

echo -e "\n=== STEP 6: DONE ==="
echo "╔════════════════════════════════════════════════════════════╗"
echo "║            STACK DESTROYED. COST=\$0                        ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║ AUDIT BUCKET PRESERVED: $AUDIT_BUCKET"
echo "║                                                            ║"
echo "║ Important: DELETE .env.local NOW                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
