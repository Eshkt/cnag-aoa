#!/bin/bash
# Load test runner for AOA Voting API
# Usage: ./run-load-test.sh <jwt_token> <api_url>

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: ./run-load-test.sh <jwt_token> <api_url>"
  echo "Example: ./run-load-test.sh 'eyJhbGci...' 'https://abc123.execute-api.us-east-1.amazonaws.com/production'"
  exit 1
fi

JWT_TOKEN="$1"
API_URL="$2"

# Backup and set trap to restore original file on exit
cp artillery.yml artillery.yml.backup
trap "mv artillery.yml.backup artillery.yml; rm -f artillery.yml.backup; echo 'Restored artillery.yml'" EXIT

# Update artillery.yml with real values
sed -i "s|JWT_TOKEN|${JWT_TOKEN}|g" artillery.yml
sed -i "s|https://YOUR_API_ID.execute-api.US-EAST-1.amazonaws.com/production|${API_URL}|g" artillery.yml

echo "Running artillery load test..."
echo "Target: ${API_URL}"

# Run artillery
artillery run artillery.yml --output report.json

# Generate summary
echo ""
echo "=== Load Test Complete ==="
cat report.json | jq '.summary' 2>/dev/null || echo "Report saved to report.json"
