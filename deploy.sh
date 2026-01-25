#!/bin/bash
echo "🚀 Starting DMS Deployment..."

cd /www/wwwroot/DMS_Server || exit 1

echo "🧹 Cleaning local changes..."
git reset --hard
git clean -fd -e Uploads

echo "⬇️ Pulling latest code..."
git pull origin main

echo "📦 Installing dependencies..."
rm -rf node_modules
npm install --production

echo "🔁 Restarting PM2 service..."
pm2 restart dms

echo "✅ DMS Deployment completed successfully!"
