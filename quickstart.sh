#!/bin/bash

# 🚀 Quick Start Script for Trading Platform
# This script sets up and starts the entire application

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║      Trading Platform - Quick Start Setup                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f "backend/.env" ]; then
    echo -e "${YELLOW}⚠️  Environment file not found. Creating from template...${NC}"
    cp backend/.env.example backend/.env
    echo -e "${RED}❌ Please update backend/.env with your configuration:${NC}"
    echo "   - Set FINNHUB_API_KEY"
    echo "   - Set database credentials"
    echo "   - Set JWT_SECRET"
    exit 1
fi

echo -e "${GREEN}✅ Found environment configuration${NC}"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "   Please install Docker from https://www.docker.com/products/docker-desktop"
    exit 1
fi
echo -e "${GREEN}✅ Docker installed${NC}"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    echo "   Please install Docker Compose"
    exit 1
fi
echo -e "${GREEN}✅ Docker Compose installed${NC}"
echo ""

echo -e "${YELLOW}📦 Building Docker images...${NC}"
docker-compose build --no-cache || {
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
}
echo ""

echo -e "${YELLOW}🚀 Starting services...${NC}"
docker-compose up -d

echo ""
echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
sleep 10

# Check if services are running
echo ""
echo -e "${YELLOW}🔍 Verifying services...${NC}"

if docker-compose ps | grep -q "trading_postgres.*Up"; then
    echo -e "${GREEN}✅ Database running${NC}"
else
    echo -e "${RED}❌ Database failed to start${NC}"
    docker-compose logs postgres
    exit 1
fi

if docker-compose ps | grep -q "trading_backend.*Up"; then
    echo -e "${GREEN}✅ Backend running${NC}"
else
    echo -e "${RED}❌ Backend failed to start${NC}"
    docker-compose logs backend
    exit 1
fi

if docker-compose ps | grep -q "trading_frontend.*Up"; then
    echo -e "${GREEN}✅ Frontend running${NC}"
else
    echo -e "${RED}❌ Frontend failed to start${NC}"
    docker-compose logs frontend
    exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              🎉 Setup Complete! 🎉                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}📊 Application URLs:${NC}"
echo -e "   🌐 Frontend:      ${GREEN}http://localhost:3000${NC}"
echo -e "   🔌 Backend API:   ${GREEN}http://localhost:5000${NC}"
echo -e "   💾 Database:      ${GREEN}localhost:5432${NC}"
echo ""
echo -e "${GREEN}📋 Useful Commands:${NC}"
echo "   View logs:        docker-compose logs -f"
echo "   Stop services:    docker-compose down"
echo "   Restart:          docker-compose restart"
echo "   Database shell:   docker-compose exec postgres psql -U trading_user -d trading_platform"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "   1. Open http://localhost:3000 in your browser"
echo "   2. Navigate to Dashboard to see stocks"
echo "   3. Go to Scanner to find trading opportunities"
echo "   4. Check Portfolio to manage positions"
echo ""
echo "Happy trading! 📈"
