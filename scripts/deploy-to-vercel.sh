#!/bin/bash

# Ensure script stops on first error
set -e

echo "🚀 Preparing deployment to Vercel..."

# Create directory for script if it doesn't exist
mkdir -p $(dirname "$0")

# Ensure all dependencies are installed
echo "📦 Installing dependencies..."
npm install

# Build the worker
echo "🔨 Building worker..."
npm run worker:build

# Ensure api directory exists
echo "📂 Checking API directory structure..."
mkdir -p api

# Run tests if they exist
if [ -f "package.json" ] && grep -q "\"test\":" "package.json"; then
  echo "🧪 Running tests..."
  npm test
fi

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
  echo "❌ Vercel CLI is not installed. Installing..."
  npm install -g vercel
fi

# Check for required environment variables
echo "🔍 Checking for required environment variables..."
required_vars=("TEMPORAL_SERVER_URL" "TEMPORAL_NAMESPACE" "WORKFLOW_TASK_QUEUE")
missing_vars=()

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    missing_vars+=("$var")
  fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
  echo "❌ Missing required environment variables: ${missing_vars[*]}"
  echo "Please set these variables before deploying."
  exit 1
fi

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel deploy --prod

echo "✅ Deployment complete!" 