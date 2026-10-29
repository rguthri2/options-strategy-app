# 🚀 Trading Platform - Setup & Installation Guide

This guide will help you set up and deploy the Trading Platform for stock options analysis with real-time technical data.

## 📋 System Requirements

- **OS**: Linux, macOS, or Windows (with WSL2)
- **CPU**: 2+ cores minimum (4+ recommended)
- **RAM**: 4GB minimum (8GB+ recommended)
- **Storage**: 20GB+ SSD
- **Network**: 100 Mbps+ internet connection

## 🔧 Software Requirements

- Node.js 18.x or higher
- npm 9.x or higher
- PostgreSQL 12.x or higher
- Docker & Docker Compose (for containerized deployment)
- Git

## 📦 Installation Methods

### Method 1: Docker Compose (Easiest - Recommended)

This is the simplest way to get everything running with one command.

#### Step 1: Clone Repository
```bash
git clone <your-repo-url>
cd options-trading-app
```

#### Step 2: Get Finnhub API Key
1. Visit https://finnhub.io/register
2. Sign up for a free account
3. Copy your API key from the dashboard

#### Step 3: Configure Environment
```bash
# Copy example environment file
cp backend/.env.example backend/.env

# Edit the .env file with your settings
nano backend/.env
```

Add your Finnhub API key:
```
FINNHUB_API_KEY=your_actual_api_key_here
```

#### Step 4: Start the Application
```bash
docker-compose up -d
```

This will:
- Start PostgreSQL database
- Start Redis cache
- Build and start the backend server
- Build and start the frontend
- Create all necessary tables

#### Step 5: Verify Installation
```bash
# Check if all services are running
docker-compose ps

# Expected output:
# CONTAINER ID   IMAGE                    STATUS
# ...           trading_postgres         Up
# ...           trading_redis            Up
# ...           trading_backend          Up
# ...           trading_frontend         Up
```

#### Step 6: Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Health Check**: http://localhost:5000/api/health

---

### Method 2: Local Development Setup

For local development without Docker.

#### Step 1: Clone Repository
```bash
git clone <your-repo-url>
cd options-trading-app
```

#### Step 2: Install PostgreSQL

**On macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**On Ubuntu/Debian:**
```bash
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**On Windows:**
- Download from https://www.postgresql.org/download/windows/
- Run installer and note the password you set for postgres user

#### Step 3: Create Database and User
```bash
# Connect to PostgreSQL
psql -U postgres

# In PostgreSQL shell:
CREATE USER trading_user WITH PASSWORD 'trading_password';
CREATE DATABASE trading_platform OWNER trading_user;
\q
```

#### Step 4: Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

Update `.env`:
```
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_USER=trading_user
DB_PASSWORD=trading_password
DB_NAME=trading_platform
FINNHUB_API_KEY=your_api_key_here
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3000
JWT_SECRET=your_jwt_secret_here
```

#### Step 5: Install Redis

**On macOS:**
```bash
brew install redis
brew services start redis
```

**On Ubuntu/Debian:**
```bash
sudo apt-get install redis-server
sudo systemctl start redis-server
```

#### Step 6: Run Database Migrations
```bash
npm run migrations
```

#### Step 7: Start Backend Server
```bash
npm run dev
```

You should see:
```
🚀 Trading Platform Backend running on http://localhost:5000
📊 Environment: development
```

#### Step 8: Frontend Setup (New Terminal)

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
echo "REACT_APP_API_URL=http://localhost:5000/api" > .env
echo "REACT_APP_SOCKET_URL=http://localhost:5000" >> .env

# Start development server
npm start
```

The browser will automatically open http://localhost:3000

---

## 🌐 VPS Deployment (Production)

### Prerequisites on VPS
```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Git
sudo apt-get install git -y

# Add current user to docker group
sudo usermod -aG docker $USER
```

### Deploy to VPS (root@70.36.114.244)

```bash
# SSH into your VPS
ssh root@70.36.114.244

# Clone the repository
git clone <your-repo-url>
cd options-trading-app

# Configure environment for production
cp backend/.env.example backend/.env

# Edit configuration
nano backend/.env
```

Set these values for production:
```
NODE_ENV=production
DB_PASSWORD=use_a_strong_password_here
FINNHUB_API_KEY=your_api_key
JWT_SECRET=use_a_long_random_string_here
FRONTEND_URL=https://your_domain.com
```

#### Deploy with Docker Compose
```bash
# Build and start services
docker-compose -f docker-compose.prod.yml up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

#### Setup Nginx Reverse Proxy

```bash
# Install Nginx
sudo apt-get install nginx -y

# Create Nginx config
sudo nano /etc/nginx/sites-available/trading
```

Paste this configuration:
```nginx
upstream trading_api {
    server 127.0.0.1:5000;
}

upstream trading_app {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    listen [::]:80;
    server_name your_domain.com www.your_domain.com;

    location /api {
        proxy_pass http://trading_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://trading_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the config:
```bash
sudo ln -s /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### Setup SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx -y

# Generate SSL certificate
sudo certbot certonly --nginx -d your_domain.com -d www.your_domain.com
```

Update Nginx config to use SSL:
```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your_domain.com www.your_domain.com;

    ssl_certificate /etc/letsencrypt/live/your_domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your_domain.com/privkey.pem;

    # ... rest of config
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name your_domain.com www.your_domain.com;
    return 301 https://$server_name$request_uri;
}
```

Restart Nginx:
```bash
sudo systemctl restart nginx
```

---

## 🧪 Testing the Installation

### Health Check
```bash
curl http://localhost:5000/api/health
# Response: {"status":"ok","timestamp":"2024-01-01T00:00:00.000Z"}
```

### Test API Endpoints
```bash
# Get stocks
curl http://localhost:5000/api/stocks

# Search for a stock
curl http://localhost:5000/api/stocks/search/AAPL

# Update stock data
curl -X POST http://localhost:5000/api/stocks/update/AAPL
```

### Test Frontend
Open http://localhost:3000 in your browser
- Navigate to Dashboard to see stocks
- Go to Scanner to find trading opportunities
- Check Portfolio section

---

## 📊 Database Management

### Backup Database
```bash
pg_dump -U trading_user -d trading_platform > backup.sql
```

### Restore Database
```bash
psql -U trading_user -d trading_platform < backup.sql
```

### Connect to Database Directly
```bash
# Via psql
psql -h localhost -U trading_user -d trading_platform

# Via Docker
docker-compose exec postgres psql -U trading_user -d trading_platform
```

---

## 🔍 Troubleshooting

### Port Already in Use
```bash
# Find process using port
lsof -i :5000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Database Connection Error
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test connection
psql -h localhost -U trading_user -d trading_platform -c "SELECT 1"
```

### Docker Issues
```bash
# View container logs
docker-compose logs backend

# Restart container
docker-compose restart backend

# Rebuild container
docker-compose up -d --build backend
```

### Memory Issues
```bash
# Check Docker memory usage
docker stats

# Increase Docker memory limit (in Docker Desktop settings or /etc/docker/daemon.json)
```

---

## 🔐 Security Checklist

- [ ] Change default database password
- [ ] Generate strong JWT secret
- [ ] Use HTTPS in production
- [ ] Set up firewall rules
- [ ] Enable database backups
- [ ] Restrict API access if needed
- [ ] Use environment variables for secrets
- [ ] Regular security updates
- [ ] Monitor application logs
- [ ] Setup SSL certificates

---

## 📈 Performance Optimization

### Database Optimization
```bash
# Connect to database
psql -U trading_user -d trading_platform

# Analyze tables
ANALYZE;

# Vacuum
VACUUM ANALYZE;
```

### Caching Strategy
- Redis caches frequent API calls
- Adjust TTL in backend code as needed

### Enable Compression
Add to Nginx config:
```nginx
gzip on;
gzip_types text/plain text/css text/javascript application/json;
gzip_min_length 1000;
```

---

## 📝 Maintenance Tasks

### Daily
- Monitor application logs
- Check database backup status

### Weekly
- Review API performance metrics
- Check for security updates

### Monthly
- Database maintenance (VACUUM, ANALYZE)
- Certificate renewal check
- Dependency updates

---

## 🆘 Getting Help

### Logs
```bash
# Backend logs
docker-compose logs -f backend

# Frontend logs  
docker-compose logs -f frontend

# Database logs
docker-compose logs -f postgres
```

### Common Issues & Solutions

**Issue**: Frontend can't connect to backend
- **Solution**: Check REACT_APP_API_URL in frontend .env

**Issue**: WebSocket connection fails
- **Solution**: Verify Socket.IO port 5000 is accessible

**Issue**: Database locked
- **Solution**: Check for running migrations or restart PostgreSQL

**Issue**: Finnhub API rate limited
- **Solution**: Upgrade Finnhub plan or implement caching

---

## 📞 Support Resources

- GitHub Issues: [Link to your repo]
- Finnhub Documentation: https://finnhub.io/docs/api
- TypeORM Documentation: https://typeorm.io/
- React Documentation: https://react.dev/
- PostgreSQL Documentation: https://www.postgresql.org/docs/

---

## 🎉 Next Steps

1. Update your Finnhub API key with your actual key
2. Configure portfolio settings
3. Set up alerts for your favorite stocks
4. Test the scanner with different criteria
5. Monitor your positions in real-time

Happy trading! 📈
