# API Rate Limits & Best Practices

## Finnhub API Rate Limits

- **Free Plan**: 60 calls/minute, limited to US market data
- **Premium Plan**: 300 calls/minute with global market data

## Backend Optimization

The backend implements several optimization strategies:

### 1. Caching Layer (Redis)
- Cache stock data for 5 minutes
- Cache price data for 1 minute
- Cache technical indicators for 5 minutes

### 2. Database Indexing
- Indexed on `symbol` (unique)
- Indexed on `timestamp` for fast queries
- Indexed on `sector` and `market_cap`

### 3. Batch Processing
- Update multiple stocks in batch
- Use bulk insert for price data
- Calculate indicators in batch

### 4. WebSocket Optimization
- Subscribe/unsubscribe to stock updates
- Only broadcast to interested clients
- Compress large data transfers

## Frontend Performance

### 1. Code Splitting
- Lazy load pages using React.lazy()
- Separate bundle for charts and indicators

### 2. Image Optimization
- Use WebP format where possible
- Lazy load images below fold

### 3. State Management
- Use Zustand for lightweight state
- Avoid unnecessary re-renders
- Memoize expensive computations

## Production Recommendations

### Scaling
- Use load balancer (nginx, HAProxy)
- Horizontal pod autoscaling (if Kubernetes)
- Database read replicas for heavy queries

### Monitoring
- Setup APM (Application Performance Monitoring)
- Monitor API response times
- Track error rates

### Security
- Implement rate limiting per IP/user
- Use WAF (Web Application Firewall)
- Encrypt sensitive data in transit
- Regular security audits

## Database Query Optimization

### Common Queries
```sql
-- Get latest price for stock (should use index)
SELECT * FROM stock_prices 
WHERE stock_id = $1 
ORDER BY timestamp DESC LIMIT 1;

-- Get indicators for period (should use index)
SELECT * FROM technical_indicators 
WHERE stock_id = $1 AND timestamp >= $2 
ORDER BY timestamp;

-- Get stocks by volume (should use index)
SELECT * FROM stocks 
WHERE is_active = true 
ORDER BY volume DESC LIMIT 100;
```

### Index Strategy
```sql
-- Key indices (already created in migrations)
CREATE INDEX idx_stocks_symbol ON stocks(symbol);
CREATE INDEX idx_stocks_sector ON stocks(sector);
CREATE INDEX idx_prices_stock_timestamp ON stock_prices(stock_id, timestamp);
CREATE INDEX idx_indicators_stock_timestamp ON technical_indicators(stock_id, timestamp);
```

## API Response Times

### Target Times
- Stock list: < 200ms
- Price history: < 500ms
- Indicators: < 300ms
- Scanner: < 2000ms

### Monitoring
Use the `/api/health` endpoint to verify system health.
