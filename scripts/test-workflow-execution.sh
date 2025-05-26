#!/bin/bash

# Script to test workflow execution via the API
# Usage: ./test-workflow-execution.sh [local|remote] [workflow_type] [resource_id]

# Default values
HOST="localhost:3000"
WORKFLOW_TYPE="dataProcessingWorkflow"
RESOURCE_ID="test-resource-$(date +%s)"

# Parse arguments
if [ "$1" == "remote" ] && [ -n "$VERCEL_URL" ]; then
  HOST="$VERCEL_URL"
  echo "🌐 Using remote host: $HOST"
elif [ "$1" == "remote" ]; then
  echo "❌ VERCEL_URL environment variable not set. Please set it to your Vercel deployment URL."
  exit 1
else
  echo "🏠 Using local host: $HOST"
fi

# Override defaults if provided
if [ -n "$2" ]; then
  WORKFLOW_TYPE="$2"
fi

if [ -n "$3" ]; then
  RESOURCE_ID="$3"
fi

echo "🔄 Testing workflow execution..."
echo "  Workflow Type: $WORKFLOW_TYPE"
echo "  Resource ID: $RESOURCE_ID"

# Create JSON payload
PAYLOAD="{\"workflowType\":\"$WORKFLOW_TYPE\",\"resourceId\":\"$RESOURCE_ID\",\"options\":{\"testMode\":true}}"

# Execute the API call
echo "📤 Sending request to http://$HOST/api/execute"
curl -X POST "http://$HOST/api/execute" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -w "\n\nStatus code: %{http_code}\n"

echo "✅ Test complete!" 