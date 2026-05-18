#!/bin/bash

# Configuration
PROFILE="aoa-dev"
REGION="ap-southeast-1"
TF_DIR="terraform"
ENV_FILE=".env.dev"

set -e
set -o pipefail

# Report tracking
STAGES=("S1:TOOLS" "S2:AWS" "S3:INIT" "S4:COMPILE" "S5:DEPLOY" "S6:VERIFY" "S7:SEED" "S8:E2E" "S9:WIPE")
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

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [[ $NODE_VER -lt 18 ]]; then log_fail "S1" "node < 18" "nvm install 18"; fi

AWS_VER=$(aws --version 2>&1 | cut -d'/' -f2 | cut -d'.' -f1 || echo 0)
if [[ $AWS_VER -lt 2 ]]; then log_fail "S1" "aws-cli < v2" "upgrade aws-cli"; fi

check_tool "terraform" "brew install terraform"
check_tool "jq" "brew install jq"
log_pass "S1"

# S2: AWS CHECK
echo "S2: Checking AWS identity..."
if ! aws sts get-caller-identity --profile $PROFILE --region $REGION &> /dev/null; then
    log_fail "S2" "AWS identity failed" "aws configure --profile $PROFILE"
fi
log_pass "S2"

# S3: INIT
echo "S3: Initializing Terraform..."
cd $TF_DIR
terraform init
cd ..
log_pass "S3"

# S4: COMPILE & BUNDLE
echo "S4: Compiling and Bundling Lambdas..."
cd aoa-voting-stack
npm install --silent
mkdir -p dist
for f in src/*/index.ts src/*/*.ts; do
    # Only bundle files named like the directory or specifically index.ts/handler.ts
    dir=$(dirname "$f")
    base=$(basename "$dir")
    file=$(basename "$f")
    if [[ "$file" == "index.ts" ]] || [[ "$file" == "$base.ts" ]]; then
        echo "Bundling $f..."
        npx esbuild "$f" --bundle --platform=node --target=node20 --outfile="dist/$base/index.js"
    fi
done
cd ..
log_pass "S4"

# S5: DEPLOY
echo "S5: Deploying with Terraform..."
cd $TF_DIR
if [ ! -f terraform.tfvars ]; then
    log_fail "S5" "terraform.tfvars missing" "create terraform.tfvars from example"
fi
terraform apply -auto-approve
# Extract outputs to root .env.dev
terraform output -json | jq -r 'to_entries | .[] | "\(.key | upcase)=\(.value.value)"' > ../$ENV_FILE
cd ..
log_pass "S5"

# Load env for remaining stages
source $ENV_FILE

# S6: VERIFY
echo "S6: Verifying resources..."
check_ddb_pitr() {
    for i in {1..5}; do
        RAW_STATUS=$(aws dynamodb describe-continuous-backups --table-name $1 --profile $PROFILE --region $REGION --output json 2>/dev/null)
        STATUS=$(echo "$RAW_STATUS" | jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' 2>/dev/null || echo "DISABLED")
        if [[ "$STATUS" == "ENABLED" ]]; then return 0; fi
        echo "Waiting for PITR to enable on $1 (attempt $i/5)..."
        sleep 5
    done
    log_fail "S6" "$1 PITR not enabled" "aws dynamodb update-continuous-backups --table-name $1 --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true"
}
check_ddb_pitr "$HAS_VOTED_TABLE"
check_ddb_pitr "$RESULTS_TABLE"

# SSM & Secret
aws ssm get-parameter --name "/voting/window-open" --profile $PROFILE --region $REGION &>/dev/null || log_fail "S6" "SSM param missing" "terraform apply"
aws secretsmanager describe-secret --secret-id hmac-signing-key-804887692450 --profile $PROFILE --region $REGION &> /dev/null || log_fail "S6" "Secret missing" "terraform apply"

# Cognito
aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID --profile $PROFILE --region $REGION &> /dev/null || log_fail "S6" "Cognito pool missing" "terraform apply"
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

aws cognito-idp create-group --group-name comelec-admin --user-pool-id $USER_POOL_ID --profile $PROFILE 2>/dev/null || true
aws cognito-idp admin-add-user-to-group --user-pool-id $USER_POOL_ID --username "comelec.head@ust.edu.ph" --group-name comelec-admin --profile $PROFILE

aws secretsmanager put-secret-value --secret-id hmac-signing-key-804887692450 --secret-string "dev-test-secret" --profile $PROFILE &> /dev/null || true
log_pass "S7"

# S8: E2E
echo "S8: Running E2E tests..."
# Clean slate for E2E
wipe_table "$HAS_VOTED_TABLE"
wipe_table "$RESULTS_TABLE"

AUTH_RESP=$(aws cognito-idp admin-initiate-auth --user-pool-id $USER_POOL_ID --client-id $USER_POOL_CLIENT_ID --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters USERNAME=juan.dela.cruz@ust.edu.ph,PASSWORD=TestPass123! --profile $PROFILE --region $REGION)
TOKEN=$(echo $AUTH_RESP | jq -r .AuthenticationResult.IdToken)

# 1. GET /status (closed)
STATUS_RESP=$(curl -s $API_URL/status)
if [[ $(echo $STATUS_RESP | jq -r '.open') != "false" ]]; then log_fail "S8" "Expected status open=false" "check SSM parameter value"; fi

# 2. Open window
aws ssm put-parameter --name "/voting/window-open" --value "true" --type String --overwrite --profile $PROFILE

# 3. GET /status (open)
echo "Waiting 35s for Lambda cache to expire..."
sleep 35
STATUS_RESP=$(curl -s $API_URL/status)
if [[ $(echo $STATUS_RESP | jq -r '.open') != "true" ]]; then log_fail "S8" "Expected status open=true" "check SSM cache logic"; fi

# 4. POST /vote
VOTE_RESP=$(curl -s -X POST -H "Authorization: $TOKEN" -d '{"proposalId":"prop1","voteChoice":"YES"}' $API_URL/vote)
if [[ $(echo $VOTE_RESP | jq -r '.message') != "vote recorded" ]]; then log_fail "S8" "Vote failed" "$VOTE_RESP"; fi

# 5. POST /vote (again)
VOTE_RESP2=$(curl -s -X POST -H "Authorization: $TOKEN" -d '{"proposalId":"prop1","voteChoice":"YES"}' $API_URL/vote)
if [[ $(echo $VOTE_RESP2 | jq -r '.message') == "vote recorded" ]]; then log_fail "S8" "Double vote allowed" "check lambda idempotency"; fi

# 6. Close window
aws ssm put-parameter --name "/voting/window-open" --value "false" --type String --overwrite --profile $PROFILE
log_pass "S8"

# S9: WIPE
echo "S9: Wiping tables..."
wipe_table "$HAS_VOTED_TABLE"
wipe_table "$RESULTS_TABLE"
log_pass "S9"

# S10: REPORT
print_report
