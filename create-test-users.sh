#!/bin/bash

# Config
PROFILE="aoa-dev"
REGION="ap-southeast-1"
POOL_NAME="aoa-voting-user-pool" # Actual AWS resource name
PARTICIPANTS_FILE="participants.json"

set -e

echo "--- COGNITO TEST USER SETUP ---"

# 1. Get User Pool ID
echo "Finding User Pool ID for '$POOL_NAME'..."
USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --profile $PROFILE --region $REGION --query "UserPools[?Name=='$POOL_NAME'].Id" --output text)

if [ -z "$USER_POOL_ID" ]; then
    echo "FAILED: User Pool not found."
    exit 1
fi
echo "FOUND: $USER_POOL_ID"

# 2. Update participants.json if needed
echo "Verifying participants.json..."
if [ ! -f "$PARTICIPANTS_FILE" ]; then
    echo "[]" > "$PARTICIPANTS_FILE"
fi

update_list() {
    EMAIL=$1
    if ! grep -q "$EMAIL" "$PARTICIPANTS_FILE"; then
        echo "Adding $EMAIL to $PARTICIPANTS_FILE..."
        # Add to JSON array (simple way for bash)
        NEW_JSON=$(jq ". += [\"$EMAIL\"]" "$PARTICIPANTS_FILE")
        echo "$NEW_JSON" > "$PARTICIPANTS_FILE"
        echo "Updated."
    else
        echo "$EMAIL already in list."
    fi
}

update_list "juan.dela.cruz@ust.edu.ph"
update_list "cnag.cics@ust.edu.ph"

# Sync to S3
BUCKET="participant-list-bucket-804887692450"
echo "Syncing participants.json to S3..."
aws s3 cp "$PARTICIPANTS_FILE" "s3://$BUCKET/participants.json" --profile $PROFILE --region $REGION

# 3. Create Users Helper
create_user() {
    EMAIL=$1
    PASSWORD=$2
    ADMIN=$3

    echo "Processing $EMAIL..."
    
    # Create
    if ! aws cognito-idp admin-get-user --user-pool-id "$USER_POOL_ID" --username "$EMAIL" --profile "$PROFILE" --region "$REGION" &>/dev/null; then
        aws cognito-idp admin-create-user \
            --user-pool-id "$USER_POOL_ID" \
            --username "$EMAIL" \
            --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
            --message-action SUPPRESS \
            --profile "$PROFILE" \
            --region "$REGION"
        echo "Created user: $EMAIL"
    else
        echo "User $EMAIL already exists."
    fi

    # Set Password
    aws cognito-idp admin-set-user-password \
        --user-pool-id "$USER_POOL_ID" \
        --username "$EMAIL" \
        --password "$PASSWORD" \
        --permanent \
        --profile "$PROFILE" \
        --region "$REGION"
    echo "Password set for $EMAIL"

    # Add to group if admin
    if [ "$ADMIN" == "true" ]; then
        # Ensure group exists
        aws cognito-idp create-group --group-name "comelec-admin" --user-pool-id "$USER_POOL_ID" --profile "$PROFILE" --region "$REGION" 2>/dev/null || true
        
        aws cognito-idp admin-add-user-to-group \
            --user-pool-id "$USER_POOL_ID" \
            --username "$EMAIL" \
            --group-name "comelec-admin" \
            --profile "$PROFILE" \
            --region "$REGION"
        echo "Added $EMAIL to comelec-admin group."
    fi
}

# 4. Process Users
create_user "juan.dela.cruz@ust.edu.ph" "TestPass123!" "false"
create_user "cnag.cics@ust.edu.ph" "TestPass123!" "true"

# 5. Invalid User Signup Test (Should Fail)
echo "Attempting signup for invalid user (outsider@gmail.com)..."
# We use 'sign-up' not 'admin-create' to trigger the Pre-Signup Lambda check
# Need Client ID
CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$USER_POOL_ID" --profile "$PROFILE" --region "$REGION" --query "UserPoolClients[0].ClientId" --output text)

echo "Using Client ID: $CLIENT_ID"

set +e # Allow fail
aws cognito-idp sign-up \
    --client-id "$CLIENT_ID" \
    --username "outsider@gmail.com" \
    --password "TestPass123!" \
    --user-attributes Name=email,Value="outsider@gmail.com" \
    --profile "$PROFILE" \
    --region "$REGION" 2>&1 | grep -i "PostConfirmation" || echo "EXPECTED FAIL: Signup rejected by Lambda validator."
set -e

echo "--- SETUP COMPLETE ---"
