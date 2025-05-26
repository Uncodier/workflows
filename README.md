# Temporal Workflows

This project integrates Temporal.io with Vercel to create a scalable, serverless workflow system that interacts with external APIs and Supabase.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run the worker in development mode
npm run worker:dev

# Execute a workflow
npm run workflow:execute dataProcessingWorkflow resource-123 '{"transform":true}'

# Create a scheduled workflow
npm run schedule:create daily-workflow dataProcessingWorkflow "0 0 * * *" '["resource-123",{"transform":true}]'
```

## 📖 Overview

This project is configured to deploy Temporal workers on Vercel's serverless infrastructure. It provides:

- **Durable workflows**: Long-running, fault-tolerant processes with Temporal.io
- **API integrations**: Connect to external APIs and process data
- **Scheduled executions**: Set up cron-like schedules for recurring tasks
- **Serverless deployment**: Deploy and scale workflows on Vercel
- **API endpoints**: Trigger workflows and manage schedules via REST API

## Features

- Temporal.io integration for durable workflows and activities
- Supabase integration for data storage and configuration management
- API integration for third-party service interactions
- Cron-like scheduling for recurring workflows

## Project Structure

```
temporal-workflows/
├── api/                   # Vercel serverless API endpoints
│   ├── worker.js          # Worker entry point
│   ├── status.js          # Status check endpoint
│   └── execute-workflow.js # Workflow execution endpoint
├── src/
│   ├── config/               # Configuration files
│   ├── lib/                  # Utility libraries
│   │   └── supabase/         # Supabase client
│   ├── scripts/              # CLI scripts
│   │   ├── start-worker.ts   # Start Temporal worker
│   │   ├── execute-workflow.ts # Execute a workflow
│   │   └── manage-schedule.ts # Manage schedules
│   └── temporal/             # Temporal.io integration
│       ├── activities/       # Workflow activities
│       ├── client/           # Temporal client
│       ├── scheduler/        # Workflow scheduler
│       ├── workers/          # Temporal workers
│       └── workflows/        # Workflow definitions
```

## Available Workflows

### Data Processing Workflow
Processes data from an API and can apply transformations.

```bash
npm run workflow:execute dataProcessingWorkflow resource-123 '{"transform":true,"storeResults":true}'
```

### Scheduled API Polling Workflow
Designed to run on a schedule to poll an API endpoint periodically.

```bash
npm run workflow:execute scheduledApiPollingWorkflow '{"endpoint":"/api/status","storeMetrics":true}'
```

To schedule this to run every 15 minutes:

```bash
npm run schedule:create api-status-poll scheduledApiPollingWorkflow "*/15 * * * *" '[{"endpoint":"/api/status","storeMetrics":true}]'
```

## Environment Variables

Create a `.env` file based on the following example:

```
# Temporal Configuration
TEMPORAL_SERVER_URL=localhost:7233
TEMPORAL_NAMESPACE=default
WORKFLOW_TASK_QUEUE=default

# Supabase Configuration
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_KEY=your-supabase-key

# API Configuration
API_BASE_URL=https://your-api-base-url
API_KEY=your-api-key

# Application Configuration
WORKFLOW_TASK_QUEUE=default
LOG_LEVEL=info
```

## Usage

### Running Workers Locally

```bash
# Run Temporal worker in development mode
npm run worker:dev
```

### Executing a Workflow

```bash
npm run workflow:execute dataProcessingWorkflow resource-123 '{"transform":true,"storeResults":true}'
```

### Creating a Scheduled Workflow

```bash
npm run schedule:create my-schedule dataProcessingWorkflow "*/10 * * * *" '["resource-123",{"transform":true}]'
```

### Listing Schedules

```bash
npm run schedule:list
```

### Deleting a Schedule

```bash
npm run schedule:delete my-schedule
```

## Deployment with Vercel

This project is configured for deployment on Vercel, with a focus on running only the Temporal workers without exposing any API routes.

### Deployment Steps

1. Connect your repository to Vercel.
2. Set up all required environment variables in the Vercel dashboard.
3. Use the following settings for deployment:
   - Build Command: `npm run vercel:build`
   - Output Directory: `dist`
   - Install Command: `npm install`

### Vercel Environment Variables

Make sure to add all required environment variables from the `.env` file to your Vercel project settings.

### Deployment Scripts

The project includes several scripts to simplify deployment:

```bash
# Optimize the project for production deployment
./scripts/optimize-for-production.sh

# Deploy to production with versioning
./scripts/production-deploy.sh [version] [environment]

# Deploy using Vercel CLI
./scripts/deploy-to-vercel.sh
```

### Testing Scripts

Test your API endpoints locally or remotely:

```bash
# Test workflow execution
./scripts/test-workflow-execution.sh [local|remote] [workflow_type] [resource_id]

# Test schedule management
./scripts/test-schedules.sh [action] [options]
# Actions: list, create, delete
# Examples:
./scripts/test-schedules.sh list
./scripts/test-schedules.sh create my-schedule dataProcessingWorkflow "0 */6 * * *"
./scripts/test-schedules.sh delete my-schedule
```

### Vercel Specific Scripts

```bash
# Build for Vercel deployment (workers only)
npm run vercel:build

# Start workers on Vercel
npm run vercel:start
```

### Vercel API Endpoints

The deployed application exposes the following API endpoints:

- **GET /api/status**: Check the status of the worker and Temporal connection
- **POST /api/execute**: Execute a workflow manually
  ```json
  {
    "workflowType": "dataProcessingWorkflow",
    "resourceId": "resource-123",
    "options": {
      "transform": true,
      "storeResults": true
    }
  }
  ```
- **GET /api/worker**: Manually trigger worker execution
- **GET|POST|DELETE /api/schedules**: Manage workflow schedules
  - **GET**: List all schedules
  - **POST**: Create a new schedule
    ```json
    {
      "scheduleName": "my-daily-workflow",
      "workflowType": "dataProcessingWorkflow",
      "cronExpression": "0 0 * * *",
      "args": ["resource-123", {"transform": true}],
      "options": {
        "taskQueue": "default"
      }
    }
    ```
  - **DELETE**: Delete a schedule (query param: `?scheduleId=my-daily-workflow`)

### Vercel Cron Jobs

The application is configured with a cron job that runs every 5 minutes to keep the worker active. You can modify the schedule in the `vercel.json` file.

## Connecting to Temporal Cloud

For production use, it's recommended to connect to Temporal Cloud:

1. Create an account at [Temporal Cloud](https://temporal.io/cloud)
2. Create a namespace for your workflows
3. Set the following environment variables:
   - `TEMPORAL_SERVER_URL`: Your Temporal Cloud address
   - `TEMPORAL_NAMESPACE`: Your namespace name
   - Add authentication details as required

## Development

To start development locally:

```bash
# Start the worker in development mode
npm run worker:dev
```
