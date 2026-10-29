# Trading Platform - Postman Collection

This folder contains API testing collections for Postman.

## 📥 Import Steps

1. Open Postman: https://www.postman.com/downloads/
2. Click "Import" → "Upload Files"
3. Select `trading-api.postman_collection.json`
4. Click "Create" or "Import"

## 🚀 Using the Collection

1. **Set Environment Variables:**
   - Click "Environments" → "Add"
   - Name: "Trading Dev"
   - Add variables:
     ```
     BASE_URL: http://localhost:5000/api
     USER_ID: user-1
     TEST_SYMBOL: AAPL
     ```

2. **Select Environment:**
   - Top right: Select "Trading Dev"

3. **Run Tests:**
   - Click folder in collection
   - "Run" button
   - Select "Keep responses saved"
   - Click "Run Trading Platform"

## 📚 Endpoint Categories

### Health & System
- `GET /health` - System health check

### Stocks
- `GET /stocks` - List all stocks
- `GET /stocks/:symbol` - Get specific stock
- `GET /stocks/search/:query` - Search stocks
- `POST /stocks/update/:symbol` - Update stock data
- `GET /stocks/sector/:sector` - Filter by sector
- `GET /stocks/top/movers` - Top 20 movers

### Prices
- `GET /prices/:symbol` - Price history
- `GET /prices/:symbol/candles` - OHLCV data
- `GET /prices/:symbol/latest` - Latest price

### Technical Indicators
- `GET /indicators/:symbol` - Latest indicators
- `GET /indicators/:symbol/history` - Indicator history
- `GET /indicators/scan/breakouts` - Scan breakouts
- `GET /indicators/scan/gaps` - Scan gaps
- `GET /indicators/scan/reversals` - Scan reversals

### Portfolio
- `GET /portfolio/:userId` - Get positions
- `POST /portfolio` - Create position
- `PUT /portfolio/:id` - Update position
- `POST /portfolio/:id/close` - Close position

### Alerts
- `GET /alerts/:userId` - Get alerts
- `POST /alerts` - Create alert
- `DELETE /alerts/:id` - Delete alert

### Scanner
- `POST /scanner/filter` - Advanced filtering
- `POST /scanner/batch-update` - Update multiple stocks

## 💡 Quick Start

1. **Set up environment variables:**
   - `{{BASE_URL}}` - API base URL
   - `{{USER_ID}}` - User ID for testing
   - `{{TEST_SYMBOL}}` - Stock symbol (AAPL, MSFT, etc)

2. **Run full test suite:**
   - Click "Run" on main folder
   - All requests execute sequentially
   - View results in Runner

3. **Test individual endpoint:**
   - Click endpoint
   - Modify parameters if needed
   - Click "Send"
   - View response

## 🔧 Troubleshooting

**Connection refused:**
- Ensure backend is running: `npm run dev`
- Check BASE_URL is correct

**401 Unauthorized:**
- Some endpoints may require JWT token
- Add to header: `Authorization: Bearer your_token`

**500 Internal Server Error:**
- Check backend logs
- Verify database connection
- Check Finnhub API key in .env

## 📊 Test Data

Use these test values:

**Stocks:**
- AAPL (Apple)
- MSFT (Microsoft)
- GOOGL (Google)
- TSLA (Tesla)
- AMZN (Amazon)

**Price Ranges:**
- Min: $10
- Max: $500
- Default: $100-200

**Volume:**
- Min: 1,000,000
- Max: 100,000,000

## 🎯 Next Steps

- Run full collection to validate all endpoints
- Modify requests to test edge cases
- Create test scenarios for different market conditions
- Set up automated test runs with Newman CLI

Happy testing! 📈
