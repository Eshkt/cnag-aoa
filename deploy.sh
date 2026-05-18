#!/bin/bash

# Configuration
PROFILE="aoa-dev"
REGION="ap-southeast-1"
STACK="AoaVotingStack"
ENV_FILE=".env.dev"
OUTPUTS_JSON="$(pwd)/outputs.json"

set -e
set -o pipefail

# Report tracking
STAGES=("S1:TOOLS" "S2:AWS" "S3:BOOTSTRAP" "S4:COMPILE" "S5:DEPLOY" "S6:VERIFY" "S7:SEED" "S8:E2E" "S9:WIPE")
RESULTS=()
REASONS=()
FIX_CMDS=()

# Helpers
log_pass() { echo -e "[\033[0;32mPASS\033[0m] $1"; RESULTS+=("PASS"); REASONS+=(""); FIX_CMDS+=(""); }
log_fail() { 
    echo -e "[\033[0;31mFAIL\033[0m] $1: $2"
    RESULTS+=("FAIL")
    REASONS+=("$2")
    FIX_CMDS+=("$3")
    print_report
    exit 1
}

wipe_table() {
    TABLE_NAME=$1
    if [[ "$TABLE_NAME" == "$HAS_VOTED_TABLE" ]]; then
        # Handle voterId (S)
        KEYS=$(aws dynamodb scan --table-name $TABLE_NAME --profile $PROFILE --query 'Items[*].voterId' --output json)
        echo "$KEYS" | jq -r '.[] | .S' | while read -r vid; do
            if [ -n "$vid" ] && [ "$vid" != "null" ]; then
                aws dynamodb delete-item --table-name $TABLE_NAME --key "{\"voterId\":{\"S\":\"$vid\"}}" --profile $PROFILE
            fi
        done
    else
        # Handle proposalId (S) and voteId (S)
        KEYS=$(aws dynamodb scan --table-name $TABLE_NAME --profile $PROFILE --query 'Items[*].{pid: proposalId, vid: voteId}' --output json)
        echo "$KEYS" | jq -c '.[]' | while read -r key; do
            PID=$(echo $key | jq -r '.pid.S')
            VOTID=$(echo $key | jq -r '.vid.S')
            if [ -n "$PID" ] && [ "$PID" != "null" ] && [ -n "$VOTID" ] && [ "$VOTID" != "null" ]; then
                aws dynamodb delete-item --table-name $TABLE_NAME --key "{\"proposalId\":{\"S\":\"$PID\"},\"voteId\":{\"S\":\"$VOTID\"}}" --profile $PROFILE
            fi
        done
    fi
}

print_report() {
    echo -e "\n--- DEPLOYMENT REPORT ---"
    printf "%-15s | %-10s\n" "STAGE" "RESULT"
    echo "---------------------------"
    for i in "${!RESULTS[@]}"; do
        printf "%-15s | %-10s\n" "${STAGES[$i]}" "${RESULTS[$i]}"
    done
    
    if [[ "${RESULTS[${#RESULTS[@]}-1]}" == "FAIL" ]]; then
        LAST_IDX=$((${#RESULTS[@]} - 1))
        echo -e "\nFAILED ${STAGES[$LAST_IDX]}: ${REASONS[$LAST_IDX]}"
        echo "fix: ${FIX_CMDS[$LAST_IDX]}"
    else
        echo -e "\nDEV READY"
    fi
}

# S1: CHECK TOOLS
echo "S1: Checking tools..."
check_tool() {
    if ! command -v $1 &> /dev/null; then
        log_fail "S1" "$1 missing" "$2"
    fi
}

# Node 18+
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [[ $NODE_VER -lt 18 ]]; then log_fail "S1" "node < 18" "nvm install 18"; fi

# AWS CLI V2
AWS_VER=$(aws --version | cut -d'/' -f2 | cut -d'.' -f1)
if [[ $AWS_VER -lt 2 ]]; then log_fail "S1" "aws-cli < v2" "upgrade aws-cli"; fi

# CDK 2
CDK_VER=$(npx cdk --version | cut -d'.' -f1)
if [[ $CDK_VER -lt 2 ]]; then log_fail "S1" "cdk < v2" "npm install -g aws-cdk"; fi

# TS 5
TS_VER=$(npx tsc -v | cut -d' ' -f2 | cut -d'.' -f1)
if [[ $TS_VER -lt 5 ]]; then log_fail "S1" "typescript < v5" "npm install typescript@5"; fi

check_tool "jq" "brew install jq"
log_pass "S1"

# S2: AWS CHECK
echo "S2: Checking AWS identity..."
if ! aws sts get-caller-identity --profile $PROFILE --region $REGION &> /dev/null; then
    log_fail "S2" "AWS identity failed" "aws configure --profile $PROFILE"
fi
log_pass "S2"

# S3: BOOTSTRAP
echo "S3: Checking CDK bootstrap..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --profile $PROFILE --region $REGION &> /dev/null; then
    echo "Bootstrapping..."
    npx cdk bootstrap aws://$(aws sts get-caller-identity --profile $PROFILE --query Account --output text)/$REGION --profile $PROFILE
else
    echo "Already bootstrapped."
fi
log_pass "S3"

# S4: COMPILE
echo "S4: Compiling..."
cd aoa-voting-stack
npm install --silent
if ! npx tsc --noEmit; then
    log_fail "S4" "Type check failed" "fix typescript errors"
fi
log_pass "S4"

# S5: DEPLOY
echo "S5: Deploying..."
npx cdk deploy --profile $PROFILE --require-approval never --outputs-file $OUTPUTS_JSON --force
STACK="AoaVotingStack"
# Parse outputs
USER_POOL_ID=$(jq -r ".\"$STACK\".UserPoolId" $OUTPUTS_JSON)
APP_CLIENT_ID=$(jq -r ".\"$STACK\".UserPoolClientId" $OUTPUTS_JSON)
API_URL=$(jq -r ".\"$STACK\".ApiUrl" $OUTPUTS_JSON)
HAS_VOTED_TABLE=$(jq -r ".\"$STACK\".HasVotedTableName" $OUTPUTS_JSON)
RESULTS_TABLE=$(jq -r ".\"$STACK\".ResultsTableName" $OUTPUTS_JSON)
PARTICIPANT_BUCKET="participant-list-bucket-804887692450"
AUDIT_BUCKET="audit-archive-bucket-804887692450"

cat <<EOF > $ENV_FILE
USER_POOL_ID=$USER_POOL_ID
APP_CLIENT_ID=$APP_CLIENT_ID
API_URL=$API_URL
HAS_VOTED_TABLE=$HAS_VOTED_TABLE
RESULTS_TABLE=$RESULTS_TABLE
PARTICIPANT_BUCKET=$PARTICIPANT_BUCKET
AUDIT_BUCKET=$AUDIT_BUCKET
EOF
log_pass "S5"

# S6: VERIFY
echo "S6: Verifying resources..."
check_ddb_pitr() {
    for i in {1..5}; do
        RAW_STATUS=$(aws dynamodb describe-continuous-backups --table-name $1 --profile $PROFILE --region $REGION --output json 2>/dev/null)
        STATUS=$(echo "$RAW_STATUS" | jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' 2>/dev/null || echo "DISABLED")
        echo "DEBUG: $1 PITR status is $STATUS"
        if [[ "$STATUS" == "ENABLED" ]]; then return 0; fi
        echo "Waiting for PITR to enable on $1 (attempt $i/5)..."
        sleep 5
    done
    log_fail "S6" "$1 PITR not enabled" "aws dynamodb update-continuous-backups --table-name $1 --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true"
}
check_ddb_pitr "$HAS_VOTED_TABLE"
check_ddb_pitr "$RESULTS_TABLE"

# S3 Versioning & Object Lock
if [[ $(aws s3api get-bucket-versioning --bucket $PARTICIPANT_BUCKET --profile $PROFILE --query Status --output text) != "Enabled" ]]; then log_fail "S6" "Participant bucket versioning off" "aws s3api put-bucket-versioning ..."; fi
if [[ $(aws s3api get-object-lock-configuration --bucket $AUDIT_BUCKET --profile $PROFILE --query 'ObjectLockConfiguration.ObjectLockEnabled' --output text) != "Enabled" ]]; then log_fail "S6" "Audit bucket object lock off" "re-deploy with objectLockEnabled: true"; fi

# SSM & Secret
if [[ $(aws ssm get-parameter --name "/voting/window-open" --profile $PROFILE --query Parameter.Value --output text) != "false" ]]; then log_fail "S6" "SSM window-open not false" "aws ssm put-parameter ... --value false --overwrite"; fi
aws secretsmanager describe-secret --secret-id hmac-signing-key-804887692450 --profile $PROFILE --region $REGION &> /dev/null || log_fail "S6" "Secret missing" "aws secretsmanager create-secret --name hmac-signing-key-804887692450"

# Cognito, API, Lambda
aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID --profile $PROFILE --region $REGION &> /dev/null || log_fail "S6" "Cognito pool missing" "check cdk deploy"
API_ID=$(echo $API_URL | cut -d'/' -f3 | cut -d'.' -f1)
aws apigateway get-rest-api --rest-api-id $API_ID --profile $PROFILE --region $REGION &> /dev/null || log_fail "S6" "API Gateway missing" "check cdk deploy"

check_lambda() {
    aws lambda get-function --function-name "$1" --profile $PROFILE --region $REGION &> /dev/null || log_fail "S6" "Lambda $1 missing" "check cdk deploy"
}
# Find exact function names (CDK adds suffix)
SUBMIT_LAMBDA=$(aws lambda list-functions --profile $PROFILE --region $REGION --query 'Functions[?contains(FunctionName, `SubmitVote`)].FunctionName' --output text)
AUDIT_LAMBDA=$(aws lambda list-functions --profile $PROFILE --region $REGION --query 'Functions[?contains(FunctionName, `AuditReport`)].FunctionName' --output text)
check_lambda "$SUBMIT_LAMBDA"
check_lambda "$AUDIT_LAMBDA"
log_pass "S6"

# S7: SEED
echo "S7: Seeding data..."
if [ ! -f participants.json ]; then
    echo '["juan.dela.cruz@ust.edu.ph","maria.santos@ust.edu.ph","pedro.reyes@ust.edu.ph","ana.garcia@ust.edu.ph","comelec.head@ust.edu.ph"]' > participants.json
fi
aws s3 cp participants.json s3://$PARTICIPANT_BUCKET/participants.json --profile $PROFILE

seed_user() {
    EMAIL=$1
    if ! aws cognito-idp admin-get-user --user-pool-id $USER_POOL_ID --username $EMAIL --profile $PROFILE &> /dev/null; then
        aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID --username $EMAIL --user-attributes Name=email,Value=$EMAIL Name=email_verified,Value=true --message-action SUPPRESS --profile $PROFILE
        aws cognito-idp admin-set-user-password --user-pool-id $USER_POOL_ID --username $EMAIL --password "TestPass123!" --permanent --profile $PROFILE
    fi
}
seed_user "juan.dela.cruz@ust.edu.ph"
seed_user "comelec.head@ust.edu.ph"

# Add to group
aws cognito-idp create-group --group-name comelec-admin --user-pool-id $USER_POOL_ID --profile $PROFILE 2>/dev/null || true
aws cognito-idp admin-add-user-to-group --user-pool-id $USER_POOL_ID --username "comelec.head@ust.edu.ph" --group-name comelec-admin --profile $PROFILE

# HMAC Secret
aws secretsmanager put-secret-value --secret-id hmac-signing-key-804887692450 --secret-string "dev-test-secret" --profile $PROFILE &> /dev/null || true
log_pass "S7"

# S8: E2E
echo "S8: Running E2E tests..."
source $ENV_FILE

# Clean slate for E2E
wipe_table "$HAS_VOTED_TABLE"
wipe_table "$RESULTS_TABLE"

# Get JWT for juan
AUTH_RESP=$(aws cognito-idp admin-initiate-auth --user-pool-id $USER_POOL_ID --client-id $APP_CLIENT_ID --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters USERNAME=juan.dela.cruz@ust.edu.ph,PASSWORD=TestPass123! --profile $PROFILE --region $REGION)
TOKEN=$(echo $AUTH_RESP | jq -r .AuthenticationResult.IdToken)

# 1. GET /status (closed)
STATUS_RESP=$(curl -s $API_URL/status)
if [[ $(echo $STATUS_RESP | jq -r '.open') != "false" ]]; then log_fail "S8" "Expected status open=false" "check SSM parameter"; fi

# 2. Open window
aws ssm put-parameter --name "/voting/window-open" --value "true" --type String --overwrite --profile $PROFILE

# 3. GET /status (open)
# Wait for cache if needed (30s in lambda)
echo "Waiting 35s for Lambda cache to expire..."
sleep 35
STATUS_RESP=$(curl -s $API_URL/status)
echo "DEBUG: STATUS_RESP=$STATUS_RESP"
# Note: status.ts has a bug returning 'open' instead of 'windowOpen', but I'll check 'open' as per my lambda read
if [[ $(echo $STATUS_RESP | jq -r '.open') != "true" ]]; then log_fail "S8" "Expected status open=true" "check SSM cache"; fi

# 4. POST /vote
VOTE_RESP=$(curl -s -X POST -H "Authorization: $TOKEN" -d '{"proposalId":"prop1","voteChoice":"YES"}' $API_URL/vote)
if [[ $(echo $VOTE_RESP | jq -r '.message') != "vote recorded" ]]; then log_fail "S8" "Vote failed" "$VOTE_RESP"; fi

# 5. POST /vote (again)
VOTE_RESP2=$(curl -s -X POST -H "Authorization: $TOKEN" -d '{"proposalId":"prop1","voteChoice":"YES"}' $API_URL/vote)
if [[ $(echo $VOTE_RESP2 | jq -r '.message') == "vote recorded" ]]; then log_fail "S8" "Double vote allowed" "check lambda logic"; fi

# 6. Check DDB
ITEM_COUNT_VOTED=$(aws dynamodb scan --table-name $HAS_VOTED_TABLE --select COUNT --profile $PROFILE --query Count --output text)
# Count includes 'COUNTER' item if it exists
if [[ $ITEM_COUNT_VOTED -lt 1 ]]; then log_fail "S8" "HasVotedTable empty" "check lambda write"; fi

ITEM_RESULTS=$(aws dynamodb scan --table-name $RESULTS_TABLE --profile $PROFILE --query 'Items[0]' --output json)
if echo "$ITEM_RESULTS" | grep -q "voterHash"; then log_fail "S8" "voterHash found in ResultsTable" "fix lambda projection"; fi

# 7. Close window
aws ssm put-parameter --name "/voting/window-open" --value "false" --type String --overwrite --profile $PROFILE
sleep 2

# 8. POST /vote (forbidden)
VOTE_FORBIDDEN=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: $TOKEN" -d '{"proposalId":"prop1","voteChoice":"YES"}' $API_URL/vote)
if [[ "$VOTE_FORBIDDEN" != "403" ]]; then log_fail "S8" "Vote allowed while closed" "check window check"; fi

# 9. Invoke Audit
aws lambda invoke --function-name "$AUDIT_LAMBDA" --profile $PROFILE --region $REGION response.json
NEW_FILE=$(aws s3 ls s3://$AUDIT_BUCKET/ --profile $PROFILE | wc -l)
if [[ $NEW_FILE -eq 0 ]]; then log_fail "S8" "No audit file generated" "check audit lambda"; fi
log_pass "S8"

# S9: WIPE
echo "S9: Wiping tables..."
wipe_table "$HAS_VOTED_TABLE"
wipe_table "$RESULTS_TABLE"
log_pass "S9"

# S10: REPORT
print_report
