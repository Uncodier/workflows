#!/bin/bash

# Script to test schedule management via the API
# Usage: ./test-schedules.sh [action] [options]
# Actions: create, list, delete
# For create: ./test-schedules.sh create [schedule_name] [workflow_type] [cron_expression]
# For delete: ./test-schedules.sh delete [schedule_id]

# Default values
HOST=${VERCEL_URL:-"localhost:3000"}
ACTION=${1:-"list"}
SCHEDULE_NAME=${2:-"test-schedule-$(date +%s)"}
WORKFLOW_TYPE=${3:-"dataProcessingWorkflow"}
CRON_EXPRESSION=${4:-"*/30 * * * *"}
ARGS=${5:-"[\"test-resource\",{\"testMode\":true}]"}

echo "🔄 Testing schedules API - Action: $ACTION"
echo "🌐 Using host: $HOST"

case $ACTION in
  "list")
    echo "📋 Listing all schedules..."
    curl -X GET "http://$HOST/api/schedules" \
      -H "Content-Type: application/json" \
      -w "\n\nStatus code: %{http_code}\n"
    ;;

  "create")
    echo "➕ Creating schedule: $SCHEDULE_NAME"
    echo "  Workflow Type: $WORKFLOW_TYPE"
    echo "  Cron Expression: $CRON_EXPRESSION"
    echo "  Args: $ARGS"
    
    # Create JSON payload
    PAYLOAD="{\"scheduleName\":\"$SCHEDULE_NAME\",\"workflowType\":\"$WORKFLOW_TYPE\",\"cronExpression\":\"$CRON_EXPRESSION\",\"args\":$ARGS}"
    
    # Execute the API call
    curl -X POST "http://$HOST/api/schedules" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      -w "\n\nStatus code: %{http_code}\n"
    ;;

  "delete")
    if [ -z "$2" ]; then
      echo "❌ Schedule ID is required for delete action"
      echo "Usage: ./test-schedules.sh delete [schedule_id]"
      exit 1
    fi
    
    echo "🗑️ Deleting schedule: $SCHEDULE_NAME"
    curl -X DELETE "http://$HOST/api/schedules?scheduleId=$SCHEDULE_NAME" \
      -H "Content-Type: application/json" \
      -w "\n\nStatus code: %{http_code}\n"
    ;;

  *)
    echo "❌ Unknown action: $ACTION"
    echo "Valid actions: list, create, delete"
    exit 1
    ;;
esac

echo "✅ Test complete!" 