#!/bin/bash

##############################################################################
# VPS DEPLOYMENT SCRIPT - ALMALINUX
# 
# Purpose: Automated setup for AlmaLinux/RHEL systems
# Usage: bash vps-deploy-almalinux.sh
# 
# Installs:
# - Node.js 18+
# - PostgreSQL 15
# - Redis
# - Nginx
# - Certbot
# - PM2
# - Build essentials
#
# AlmaLinux-specific: Uses yum/dnf instead of apt
##############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verify running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root${NC}"
   echo "Try: sudo bash vps-deploy-almalinux.sh"
   exit 1
fi

echo -e "${YELLOW}🚀 AlmaLinux VPS Deployment Script${NC}"
echo -e "${YELLOW}=====================================${NC}"

# Step 1: System Update
echo -e "\n${YELLOW}📦 Step 1: Updating system...${NC}"
yum update -y
echo -e "${GREEN}✅ System updated${NC}"

# Step 2: Install Node.js 18
echo -e "\n${YELLOW}📦 Step 2: Installing Node.js 18+...${NC}"
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs
NODE_VERSION=$(node --version)
echo -e "${GREEN}✅ Node.js installed: $NODE_VERSION${NC}"

# Step 3: Install PostgreSQL 15
echo -e "\n${YELLOW}📦 Step 3: Installing PostgreSQL 15...${NC}"
yum install -y postgresql15-server postgresql15-contrib
/usr/pgsql-15/bin/postgresql-15-setup initdb
systemctl start postgresql-15
systemctl enable postgresql-15
PG_VERSION=$(sudo -u postgres /usr/pgsql-15/bin/psql --version 2>/dev/null || echo "PostgreSQL 15")
echo -e "${GREEN}✅ PostgreSQL installed: $PG_VERSION${NC}"

# Step 4: Install Redis
echo -e "\n${YELLOW}📦 Step 4: Installing Redis...${NC}"
yum install -y redis
systemctl start redis
systemctl enable redis
REDIS_VERSION=$(redis-cli --version)
echo -e "${GREEN}✅ Redis installed: $REDIS_VERSION${NC}"

# Step 5: Install Nginx
echo -e "\n${YELLOW}📦 Step 5: Installing Nginx...${NC}"
yum install -y nginx
systemctl start nginx
systemctl enable nginx
NGINX_VERSION=$(nginx -v 2>&1)
echo -e "${GREEN}✅ Nginx installed: $NGINX_VERSION${NC}"

# Step 6: Install Certbot
echo -e "\n${YELLOW}📦 Step 6: Installing Certbot...${NC}"
yum install -y certbot python3-certbot-nginx
echo -e "${GREEN}✅ Certbot installed${NC}"

# Step 7: Install Build Essentials
echo -e "\n${YELLOW}📦 Step 7: Installing build tools...${NC}"
yum groupinstall -y "Development Tools"
yum install -y gcc g++ make python3-devel
echo -e "${GREEN}✅ Build tools installed${NC}"

# Step 8: Install PM2 globally
echo -e "\n${YELLOW}📦 Step 8: Installing PM2...${NC}"
npm install -g pm2
PM2_VERSION=$(pm2 --version)
echo -e "${GREEN}✅ PM2 installed: $PM2_VERSION${NC}"

# Step 9: Verify All Services
echo -e "\n${YELLOW}🔍 Verifying all services...${NC}"
echo ""

# Check Node.js
echo -n "Node.js: "
node --version && echo -e "${GREEN}✅${NC}" || echo -e "${RED}❌${NC}"

# Check PostgreSQL
echo -n "PostgreSQL: "
sudo -u postgres /usr/pgsql-15/bin/psql --version 2>/dev/null && echo -e "${GREEN}✅${NC}" || echo -e "${RED}❌${NC}"

# Check Redis
echo -n "Redis: "
redis-cli ping 2>/dev/null && echo -e "${GREEN}✅${NC}" || echo -e "${RED}❌${NC}"

# Check Nginx
echo -n "Nginx: "
nginx -v 2>&1 && echo -e "${GREEN}✅${NC}" || echo -e "${RED}❌${NC}"

# Check Certbot
echo -n "Certbot: "
certbot --version 2>&1 && echo -e "${GREEN}✅${NC}" || echo -e "${RED}❌${NC}"

# Check PM2
echo -n "PM2: "
pm2 --version && echo -e "${GREEN}✅${NC}" || echo -e "${RED}❌${NC}"

echo ""
echo -e "${GREEN}════════════════════════════════════${NC}"
echo -e "${GREEN}✅ ALL SERVICES INSTALLED SUCCESSFULLY!${NC}"
echo -e "${GREEN}════════════════════════════════════${NC}"

echo -e "\n${YELLOW}📋 Next Steps:${NC}"
echo "1. Create database:"
echo "   sudo -u postgres /usr/pgsql-15/bin/psql"
echo ""
echo "2. Then run these SQL commands:"
echo "   CREATE USER trading_user WITH PASSWORD 'trading_password_123';"
echo "   CREATE DATABASE trading_platform OWNER trading_user;"
echo "   ALTER ROLE trading_user CREATEDB;"
echo "   \\q"
echo ""
echo "3. Clone your application and deploy!"
echo ""
echo -e "${YELLOW}📝 Service Commands (AlmaLinux):${NC}"
echo "   Start PostgreSQL: systemctl start postgresql-15"
echo "   Start Redis:      systemctl start redis"
echo "   Start Nginx:      systemctl start nginx"
echo "   Check status:     systemctl status postgresql-15"
echo ""

exit 0
