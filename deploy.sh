#!/bin/bash

# Trading Platform Deployment Script
# This script deploys the application to a VPS

set -e

echo "🚀 Starting Trading Platform Deployment..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✅ Docker is installed"

# Create environment file if it doesn't exist
if [ ! -f "backend/.env" ]; then
    echo "📝 Creating environment file..."
    cp backend/.env.example backend/.env
    echo "⚠️  Please update backend/.env with your configuration"
    echo "   - Set FINNHUB_API_KEY"
    echo "   - Set database credentials"
    exit 1
fi

echo "📦 Building Docker images..."
docker-compose build

echo "🚀 Starting services..."
docker-compose up -d

echo "⏳ Waiting for services to be ready..."
sleep 10

echo "✅ Services started successfully!"
echo ""
echo "📊 Application URLs:"
echo "  - Frontend: http://localhost:3000"
echo "  - Backend API: http://localhost:5000"
echo "  - Database: localhost:5432"
echo ""
echo "📋 Available commands:"
echo "  - View logs: docker-compose logs -f"
echo "  - Stop services: docker-compose down"
echo "  - Restart services: docker-compose restart"
echo ""
echo "🎉 Deployment complete!"
