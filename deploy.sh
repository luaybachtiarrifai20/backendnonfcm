#!/bin/bash

# Deployment script for Backend Manajemen Sekolah
# Usage: ./deploy.sh

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Are you in the project directory?"
    exit 1
fi

# Pull latest code (if using Git)
if [ -d ".git" ]; then
    echo "📥 Pulling latest code from Git..."
    git pull origin main
else
    echo "⚠️  Not a Git repository, skipping git pull"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p logs
mkdir -p uploads

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Please create .env file from .env.example before running the app"
fi

# Restart application with PM2
echo "🔄 Restarting application..."
if pm2 list | grep -q "backend-sekolah"; then
    pm2 restart backend-sekolah
else
    pm2 start ecosystem.config.js
    pm2 save
fi

# Show status
echo "✅ Deployment completed!"
echo ""
echo "📊 Application status:"
pm2 status

echo ""
echo "📝 View logs with: pm2 logs backend-sekolah"
echo "🔍 Monitor with: pm2 monit"

