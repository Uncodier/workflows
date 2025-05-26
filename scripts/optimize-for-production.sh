#!/bin/bash

# Script to optimize the project for production deployment
# Usage: ./optimize-for-production.sh

set -e

echo "🔧 Optimizing project for production deployment..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist
rm -rf .vercel

# Install dependencies for production
echo "📦 Installing production dependencies..."
npm ci --production

# Build for production
echo "🔨 Building for production..."
npm run vercel:build

# Clean up development files not needed in production
echo "🧹 Removing unnecessary files for production..."
find node_modules -name "*.ts" -type f -delete
find node_modules -name "*.map" -type f -delete
find node_modules -name "*.md" -type f -delete
find node_modules -name "LICENSE*" -type f -delete
find node_modules -name "*.d.ts" -type f -not -path "*/@types/*" -delete

# Optimize node_modules
echo "📦 Optimizing node_modules size..."
npm prune --production

# Check final bundle size
echo "📏 Final bundle size:"
du -sh dist node_modules

echo "✅ Optimization complete!"
echo "🚀 The project is now ready for production deployment."
echo "⏭️ Next steps: Run './scripts/production-deploy.sh' to deploy to Vercel." 