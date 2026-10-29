# 🚀 Getting Started - Options Trading Platform

## Quick Setup (5 minutes)

This guide walks you through getting the platform running locally for the first time.

## Option 1️⃣: Database Initialization

### Step 1: Install PostgreSQL

**Windows:**
- Download from: https://www.postgresql.org/download/windows/
- Run installer, note the password you create for `postgres` user
- Default port: 5432

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Step 2: Create Database & User

```bash
# Connect to PostgreSQL
psql -U postgres

# Run these commands in PostgreSQL shell:
CREATE USER trading_user WITH PASSWORD 'trading_password_123';
CREATE DATABASE trading_platform OWNER trading_user;
ALTER ROLE trading_user CREATEDB;
\q
```

**Verify connection:**
```bash
psql -h localhost -U trading_user -d trading_platform -c "SELECT 1;"
```

✅ You should see: `?column?`  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`1`

### Step 3: Configure Backend Environment

```bash
cd backend

# Create .env file
cp .env.example .env

# Edit .env with your settings
```

**Windows (PowerShell):**
```powershell
notepad .env
```

**macOS/Linux:**
```bash
nano .env
```

**Update these values in `.env`:**
```
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_USER=trading_user
DB_PASSWORD=trading_password_123
DB_NAME=trading_platform
FINNHUB_API_KEY=GET_THIS_FROM_STEP_4
JWT_SECRET=my-super-secret-key-change-this-in-production
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3000
```

### Step 4: Get Finnhub API Key (Free)

1. Visit: https://finnhub.io/register
2. Sign up with email
3. Copy API key from dashboard
4. Paste into `.env` as `FINNHUB_API_KEY`

**Free tier includes:**
- 60 API calls per minute
- US stock market data
- Good enough for development & testing

### Step 5: Install Dependencies & Initialize Database

```bash
# From backend directory
npm install

# Run database migrations (creates tables)
npm run migrations
```

✅ You should see:
```
query: CREATE TABLE "stocks" ...
query: CREATE TABLE "stock_prices" ...
query: CREATE TABLE "technical_indicators" ...
query: CREATE TABLE "portfolios" ...
query: CREATE TABLE "user_alerts" ...
```

**Verify tables were created:**
```bash
psql -h localhost -U trading_user -d trading_platform

# In PostgreSQL shell:
\dt
```

✅ You should see all 5 tables listed.

### Step 6: Install Redis (for caching)

**Windows (Option A - WSL2):**
```bash
# In WSL2 terminal
sudo apt-get install redis-server
sudo service redis-server start
```

**Windows (Option B - Windows Subsystem for Linux):**
- Download from Docker Hub: https://hub.docker.com/_/redis
- Or use: `wsl --install Ubuntu` then follow Linux steps

**macOS:**
```bash
brew install redis
brew services start redis
```

**Linux:**
```bash
sudo apt-get install redis-server
sudo systemctl start redis-server
```

**Verify Redis is running:**
```bash
redis-cli ping
```

✅ You should see: `PONG`

### Database Initialization Complete! ✅

Your database is now ready with:
- ✅ 5 tables (stocks, stock_prices, technical_indicators, portfolios, user_alerts)
- ✅ Proper indexes for performance
- ✅ Foreign key relationships
- ✅ Ready for data insertion

---

## Option 2️⃣: API Testing

### Step 1: Start Backend Server

```bash
# From backend directory
npm run dev
```

✅ You should see:
```
🚀 Trading Platform Backend running on http://localhost:5000
📊 Environment: development
✅ Database connected successfully
```

### Step 2: Test Health Endpoint

**Terminal/PowerShell:**
```bash
curl http://localhost:5000/api/health
```

**Or use Postman:**
- URL: `GET http://localhost:5000/api/health`
- Click "Send"

✅ Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Step 3: Seed Initial Stock Data

```bash
# Get a sample stock
curl http://localhost:5000/api/stocks/search/AAPL
```

✅ Response shows available stocks from Finnhub

### Step 4: Add Stock to Platform & Update Data

```bash
# Update a stock (fetches latest data from Finnhub)
curl -X POST http://localhost:5000/api/stocks/update/AAPL
```

✅ Response:
```json
{
  "id": "uuid-here",
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "price": 195.50,
  "volume": 45000000,
  "sector": "Technology",
  ...
}
```

### Step 5: Test Key Endpoints

#### Get All Stocks
```bash
curl http://localhost:5000/api/stocks
```

#### Get Stock Details
```bash
curl http://localhost:5000/api/stocks/AAPL
```

#### Get Price History (last 30 days)
```bash
curl "http://localhost:5000/api/prices/AAPL?days=30"
```

#### Get Chart Data (candlesticks)
```bash
curl "http://localhost:5000/api/prices/AAPL/candles?days=100"
```

#### Get Technical Indicators
```bash
curl http://localhost:5000/api/indicators/AAPL
```

#### Scan for Breakouts
```bash
curl http://localhost:5000/api/indicators/scan/breakouts
```

#### Scan for Gaps
```bash
curl http://localhost:5000/api/indicators/scan/gaps
```

#### Get Top Movers
```bash
curl http://localhost:5000/api/stocks/top/movers
```

### Step 6: Create Test Portfolio Position

```bash
curl -X POST http://localhost:5000/api/portfolio \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-1",
    "symbol": "AAPL",
    "entry_price": 195.50,
    "shares": 10,
    "position_type": "long",
    "stop_loss": 185.00,
    "take_profit": 210.00
  }'
```

✅ Response shows your position with calculated P&L

### Step 7: Get Portfolio

```bash
curl http://localhost:5000/api/portfolio/user-1
```

✅ Shows all open positions for user-1

### Step 8: Create Alert

```bash
curl -X POST http://localhost:5000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-1",
    "symbol": "AAPL",
    "alert_type": "price",
    "trigger_price": 200,
    "trigger_condition": "above"
  }'
```

### Step 9: Test Real-time WebSocket (Advanced)

Open another terminal and run:

```bash
# Install wscat if not present
npm install -g wscat

# Connect to WebSocket
wscat -c ws://localhost:5000/socket.io/?transport=websocket

# Subscribe to stock updates
> {"type": "subscribe", "symbol": "AAPL"}

# You'll receive real-time updates
< {"symbol": "AAPL", "price": 195.50, "volume": 45000000, ...}
```

---

## 📊 API Testing Checklist

| Endpoint | Method | Status | Response |
|----------|--------|--------|----------|
| `/api/health` | GET | ✅ | `{"status":"ok"}` |
| `/api/stocks` | GET | ✅ | Array of stocks |
| `/api/stocks/:symbol` | GET | ✅ | Single stock |
| `/api/stocks/update/:symbol` | POST | ✅ | Updated stock |
| `/api/prices/:symbol` | GET | ✅ | Price history |
| `/api/prices/:symbol/candles` | GET | ✅ | OHLCV data |
| `/api/indicators/:symbol` | GET | ✅ | Latest indicators |
| `/api/indicators/scan/breakouts` | GET | ✅ | Breakout list |
| `/api/portfolio/:userId` | GET | ✅ | User positions |
| `/api/portfolio` | POST | ✅ | New position |
| `/api/alerts/:userId` | GET | ✅ | User alerts |
| `/api/alerts` | POST | ✅ | New alert |

---

## ✅ Troubleshooting

### "psql: could not connect to server"
```bash
# Check if PostgreSQL is running
# Windows: Services app → PostgreSQL
# macOS: brew services list
# Linux: sudo systemctl status postgresql

# Restart if needed
# macOS: brew services restart postgresql@15
# Linux: sudo systemctl restart postgresql
```

### "Database does not exist"
```bash
# Recreate database
psql -U postgres
CREATE DATABASE trading_platform;
\q
```

### "Module not found: @/config/database"
```bash
# Install dependencies
npm install

# Check tsconfig.json has paths configured
cat tsconfig.json
```

### "redis: Error: connect ECONNREFUSED 127.0.0.1:6379"
```bash
# Start Redis
# macOS: brew services start redis
# Linux: sudo systemctl start redis-server

# Test connection
redis-cli ping
# Should return: PONG
```

### "Finnhub API error: Unauthorized"
- Verify `FINNHUB_API_KEY` in `.env` is correct
- Check at https://finnhub.io/dashboard (logged in)
- Free tier has 60 calls/min limit

---

## 🎉 Next Steps

1. ✅ Database initialized
2. ✅ API endpoints tested
3. 📱 Start frontend: `cd frontend && npm start`
4. 🔍 Use Scanner to find opportunities
5. 📊 Monitor positions in Portfolio
6. 🚀 Deploy to VPS when ready

---

## 📚 Documentation

- [SETUP_GUIDE.md](SETUP_GUIDE.md) - Full installation guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - System design
- [README.md](README.md) - Project overview
- [PERFORMANCE.md](PERFORMANCE.md) - Optimization tips

**Need help?** Check the logs:
```bash
# Backend logs
npm run dev

# Database logs (Linux)
sudo tail -f /var/log/postgresql/postgresql.log
```

Happy trading! 📈
