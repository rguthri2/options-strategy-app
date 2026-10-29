#!/bin/bash

# 🚀 Automated Setup & Test Script
# Complete setup from zero to working application

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Trading Platform - Automated Setup & Test                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install from https://nodejs.org/${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js installed: $(node --version)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ npm installed: $(npm --version)${NC}"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ PostgreSQL not found. Please install from https://www.postgresql.org/download/${NC}"
    exit 1
fi
echo -e "${GREEN}✅ PostgreSQL installed${NC}"

# Check Redis
if ! command -v redis-cli &> /dev/null; then
    echo -e "${YELLOW}⚠️  Redis not found. Some features will be limited.${NC}"
else
    echo -e "${GREEN}✅ Redis installed${NC}"
fi

echo ""
echo -e "${YELLOW}🔧 Setting up backend...${NC}"

# Navigate to backend
cd backend || exit 1

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}⚠️  Please update .env with your configuration:${NC}"
    echo "   - Finnhub API Key: https://finnhub.io/register"
    echo "   - Database credentials (default: trading_user/trading_password_123)"
    echo ""
    read -p "Press enter after updating .env..."
fi

# Install dependencies
echo -e "${YELLOW}Installing npm dependencies...${NC}"
npm install

# Check if database exists
echo -e "${YELLOW}📊 Checking database...${NC}"

# Create database if needed (this requires postgresql to be running)
DB_EXISTS=$(psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'trading_platform';" 2>/dev/null || echo "")

if [ -z "$DB_EXISTS" ]; then
    echo -e "${YELLOW}Creating database...${NC}"
    psql -U postgres -c "CREATE USER trading_user WITH PASSWORD 'trading_password_123' CREATEDB;" 2>/dev/null || true
    psql -U postgres -c "CREATE DATABASE trading_platform OWNER trading_user;" 2>/dev/null || true
    echo -e "${GREEN}✅ Database created${NC}"
else
    echo -e "${GREEN}✅ Database already exists${NC}"
fi

# Run migrations
echo -e "${YELLOW}Running database migrations...${NC}"
npm run migrations 2>/dev/null || {
    echo -e "${RED}❌ Migration failed. Check database connection.${NC}"
    exit 1
}
echo -e "${GREEN}✅ Database initialized${NC}"

echo ""
echo -e "${YELLOW}✅ Setup complete!${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Start Redis (if you want caching):"
echo "   macOS: brew services start redis"
echo "   Linux: sudo systemctl start redis-server"
echo ""
echo "2. Start the backend server:"
echo "   npm run dev"
echo ""
echo "3. In another terminal, run tests:"
echo "   node ../test-api.js"
echo ""
echo "4. Start the frontend:"
echo "   cd ../frontend"
echo "   npm install"
echo "   npm start"
echo ""
