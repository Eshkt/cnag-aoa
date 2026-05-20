#!/bin/bash
set -e

echo "Step 1: Syncing package-lock..."
rm -f package-lock.json && npm install
echo "DONE"

echo "Step 2: Deploying HMAC secret to SSM..."
aws ssm put-parameter \
  --name "/amplify/d23np9c7e29dad/main/HMAC_SECRET" \
  --value "dev-test-secret-not-for-prod" \
  --type SecureString \
  --region ap-southeast-1 \
  --profile aoa-dev \
  --overwrite
echo "DONE"

echo "Step 3: Staging changes..."
git add package-lock.json package.json amplify.yml fix-and-push.sh
echo "DONE"

echo "Step 4: Committing..."
git commit -m "fix: region ap-southeast-1 + sandbox collision cleared"
echo "DONE"

echo "Step 5: Pushing..."
git push origin main
echo "DONE"
