#!/bin/bash

# Script to handle production deployment with versioning
# Usage: ./production-deploy.sh [version] [environment]

set -e

# Default values
VERSION=${1:-$(date +"%Y%m%d%H%M")}
ENV=${2:-"production"}
BRANCH="main"

echo "🚀 Preparing production deployment..."
echo "📦 Version: $VERSION"
echo "🌐 Environment: $ENV"

# Create a tag for this release
echo "🏷️ Creating git tag v$VERSION..."
git tag -a "v$VERSION" -m "Production release v$VERSION to $ENV"

# Make sure we have the latest dependencies
echo "📚 Installing dependencies..."
npm install

# Build for production
echo "🔨 Building for production..."
npm run vercel:build

# Run tests if available
if [ -f "package.json" ] && grep -q "\"test\":" "package.json"; then
  echo "🧪 Running tests..."
  npm test
fi

# Deploy to Vercel production
echo "🚀 Deploying to Vercel ($ENV)..."
vercel deploy --prod --env WORKFLOW_VERSION="$VERSION"

# Push the tag to remote
echo "📤 Pushing tag to remote..."
git push origin "v$VERSION"

echo "✅ Deployment complete!"
echo "📝 Version $VERSION is now live on $ENV" 