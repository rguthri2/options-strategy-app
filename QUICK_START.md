# 🚀 Quick Reference - Get Running in 15 Minutes

## TL;DR - Fastest Path to Working App

### Prerequisites (Install Once)
- Node.js 18+ - https://nodejs.org/
- PostgreSQL - https://www.postgresql.org/download/
- Git - https://git-scm.com/

### Step 1: Database Setup (2 minutes)

```bash
# Windows: Open PostgreSQL client
# macOS/Linux: Terminal
psql -U postgres

# Run these commands:
CREATE USER trading_user WITH PASSWORD 'trading_password_123';
CREATE DATABASE trading_platform OWNER trading_user;
\q
```

### Step 2: Configure App (1 minute)

```bash
cd backend
cp .env.example .env
```

Edit `.env` - Add your Finnhub API key from: https://finnhub.io/register

**At minimum change:**
```
FINNHUB_API_KEY=pk_xxxxxxxx
```

### Step 3: Install & Initialize (5 minutes)

```bash
cd backend
npm install
npm run migrations
```

### Step 4: Start Backend (1 minute)

```bash
npm run dev
```

✅ You should see: `🚀 Trading Platform Backend running on http://localhost:5000`

### Step 5: Test It Works (2 minutes)

**Terminal 2:**
```bash
# Test health
curl http://localhost:5000/api/health

# Get stocks list
curl http://localhost:5000/api/stocks

# Run full test suite
node test-api.js
```

✅ You should see: `✅ All tests passed!`

### Step 6: Frontend (Optional)

```bash
# Terminal 3
cd frontend
npm install
npm start
```

✅ Browser opens to http://localhost:3000

---

## 📋 Command Reference

| Task | Command |
|------|---------|
| Start backend | `cd backend && npm run dev` |
| Start frontend | `cd frontend && npm start` |
| Test API | `node test-api.js` (from root) |
| Run migrations | `cd backend && npm run migrations` |
| Connect to database | `psql -U trading_user -d trading_platform` |
| View logs | See backend terminal output |
| Stop server | `Ctrl+C` in terminal |

---

## 🔑 Key Endpoints to Test

```bash
# Health check
curl http://localhost:5000/api/health

# Get all stocks
curl http://localhost:5000/api/stocks

# Get specific stock
curl http://localhost:5000/api/stocks/AAPL

# Search stocks
curl http://localhost:5000/api/stocks/search/MSFT

# Update stock (fetch latest from Finnhub)
curl -X POST http://localhost:5000/api/stocks/update/AAPL

# Get price history
curl "http://localhost:5000/api/prices/AAPL?days=30"

# Get chart data
curl http://localhost:5000/api/prices/AAPL/candles

# Get technical indicators
curl http://localhost:5000/api/indicators/AAPL

# Scan for breakouts
curl http://localhost:5000/api/indicators/scan/breakouts

# Create position
curl -X POST http://localhost:5000/api/portfolio \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user-1","symbol":"AAPL","entry_price":195.50,"shares":10,"position_type":"long"}'
```

---

## ⚠️ Common Issues & Fixes

### "Connection refused"
```
❌ Backend not running
✅ Fix: npm run dev in backend folder
```

### "Database does not exist"
```
❌ PostgreSQL not connected
✅ Fix: 
   1. Start PostgreSQL service
   2. Run psql commands above
   3. Run: npm run migrations
```

### "FINNHUB_API_KEY not valid"
```
❌ Missing or wrong API key
✅ Fix:
   1. Get key from https://finnhub.io/register
   2. Update .env file
   3. Restart backend
```

### "Port 5000 already in use"
```
❌ Another app using port 5000
✅ Fix: 
   Windows: netstat -ano | findstr :5000
   macOS/Linux: lsof -i :5000
   Then kill the process
```

### "npm: command not found"
```
❌ Node.js not installed
✅ Fix: Install from https://nodejs.org/
```

---

## 📚 Full Documentation

| Document | Purpose |
|----------|---------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Detailed setup guide |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design & data flow |
| [README.md](README.md) | Project overview |
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | Installation methods |
| [PERFORMANCE.md](PERFORMANCE.md) | Optimization tips |

---

## 🎯 What's Next?

1. ✅ Backend running
2. ✅ Database initialized  
3. ✅ API tested
4. 📱 Frontend UI testing
5. 🔍 Use Scanner to find trades
6. 📊 Track positions in Portfolio
7. 🚀 Deploy to VPS

---

## 💡 Pro Tips

- **Use Postman** for easier API testing: [POSTMAN_GUIDE.md](POSTMAN_GUIDE.md)
- **Watch server logs** for debugging
- **Free Finnhub tier** has 60 calls/min limit
- **Docker Compose** for easier multi-service setup: `docker-compose up`

---

## 🆘 Need Help?

Check these in order:

1. Run tests: `node test-api.js`
2. Check logs: Look at terminal output
3. Read [GETTING_STARTED.md](GETTING_STARTED.md)
4. Check backend/.env configuration
5. Verify PostgreSQL is running

---

**You're all set! Happy trading! 📈**

For detailed steps, see [GETTING_STARTED.md](GETTING_STARTED.md)
