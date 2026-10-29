# 🏗️ Architecture & System Design

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Browser                          │
│                 (React 18 + TypeScript)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                    HTTP/WebSocket
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Nginx Reverse Proxy (Production)               │
│            (SSL/TLS + Load Balancing)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   HTTP │           WebSocket        HTTP │
        │                │                │
┌───────▼──────┐  ┌──────▼──────┐  ┌─────▼──────────┐
│   Express    │  │ Socket.IO   │  │  Static Files  │
│   Backend    │  │   Server    │  │   Frontend     │
│  (Port 5000) │  │ (Port 5000) │  │  (Port 3000)   │
└───────┬──────┘  └──────┬──────┘  └────────────────┘
        │                │
        └────────────────┼────────────────┐
                         │                │
            ┌────────────▼──────────┐     │
            │  Data Processing     │     │
            │  & Calculations      │     │
            └────────────┬─────────┘     │
                         │               │
        ┌────────────────┼───────────────┼─────┐
        │                │               │     │
   SQL  │        Redis Cache      Finnhub API  │
        │                │               │     │
┌───────▼──────────┐ ┌──▼───────┐  ┌────▼─────┐
│  PostgreSQL      │ │ Redis    │  │ Finnhub  │
│  Database        │ │ Cache    │  │ Service  │
│ (Port 5432)      │ │(Port6379)│  │  (Cloud) │
└──────────────────┘ └──────────┘  └──────────┘
```

## Component Architecture

### Frontend Layer (React)
```
App
├── Pages
│   ├── Dashboard         (Market overview, top stocks)
│   ├── StockDetail       (Chart, indicators, analysis)
│   ├── Scanner           (Pattern detection, filtering)
│   └── Portfolio         (Position management)
├── Components
│   ├── Navbar            (Navigation, branding)
│   ├── Chart             (Lightweight Charts integration)
│   ├── IndicatorPanel    (Technical indicators display)
│   ├── PositionCard      (Portfolio position)
│   └── ScannerResults    (Scanner results table)
├── Services
│   ├── api.ts            (HTTP client)
│   └── websocket.ts      (WebSocket client)
├── Stores
│   └── Store             (Zustand state management)
└── Styles
    ├── globals.css       (Global styles)
    ├── navbar.css
    ├── dashboard.css
    ├── stock-detail.css
    ├── scanner.css
    └── portfolio.css
```

### Backend Layer (Node.js/Express)
```
Backend
├── src
│   ├── index.ts          (Express server setup)
│   ├── config
│   │   └── database.ts   (TypeORM configuration)
│   ├── models            (Database entities)
│   │   ├── Stock.ts
│   │   ├── StockPrice.ts
│   │   ├── TechnicalIndicator.ts
│   │   ├── Portfolio.ts
│   │   └── UserAlert.ts
│   ├── services
│   │   ├── finnhubService.ts      (API integration)
│   │   ├── technicalAnalysisService.ts (Indicators)
│   │   └── cachingService.ts      (Redis caching)
│   ├── routes
│   │   ├── stocks.ts      (Stock endpoints)
│   │   ├── prices.ts      (Price endpoints)
│   │   ├── indicators.ts  (Indicator endpoints)
│   │   ├── portfolio.ts   (Portfolio endpoints)
│   │   ├── alerts.ts      (Alert endpoints)
│   │   └── scanner.ts     (Scanner endpoints)
│   ├── middleware
│   │   ├── auth.ts        (JWT verification)
│   │   ├── validation.ts  (Input validation)
│   │   └── errorHandler.ts (Error handling)
│   └── migrations
│       └── 1699000000000-CreateStocksTables.ts
├── Dockerfile
└── package.json
```

### Data Layer (PostgreSQL + Redis)
```
PostgreSQL Database
├── stocks (master data)
│   ├── symbol (unique)
│   ├── name
│   ├── sector
│   ├── market_cap
│   └── ...
├── stock_prices (time-series)
│   ├── stock_id (foreign key)
│   ├── timestamp (indexed)
│   ├── open, high, low, close
│   └── volume
├── technical_indicators (calculated)
│   ├── stock_id (foreign key)
│   ├── timestamp
│   ├── ema_21, ma_50, ma_200
│   ├── rsi_14, macd, bb_*
│   └── pattern flags
├── portfolios (positions)
│   ├── user_id
│   ├── symbol
│   ├── entry_price, shares
│   └── stop_loss, take_profit
└── user_alerts (notifications)
    ├── user_id
    ├── symbol
    ├── alert_type
    └── trigger conditions

Redis Cache
├── stock:{symbol} → Stock data (5 min TTL)
├── price:{symbol} → Latest price (1 min TTL)
├── indicators:{symbol} → Indicators (5 min TTL)
└── session:{session_id} → User session
```

## Data Flow

### Real-time Stock Update Flow
```
┌─────────────────────┐
│  Finnhub API        │
│ (Market Data)       │
└──────────┬──────────┘
           │
           │ Periodic Poll (Every 1-5 min)
           │
┌──────────▼──────────┐
│  finnhubService     │
│  (Data Fetcher)     │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
    │ Save        │ Cache
    │             │
┌───▼────┐   ┌───▼───┐
│ Stock  │   │ Redis │
│ Prices │   │       │
└───┬────┘   └───────┘
    │
    │
┌───▼────────────────┐
│ Technical Analysis │
│ Service            │
│ (Calculate)        │
└───┬────────────────┘
    │
    │ Calculate Indicators
    │
┌───▼──────────┐
│ Indicators   │
│ Table        │
└──────────────┘
    │
    │ WebSocket Emit
    │
┌───▼──────────┐
│ Connected    │
│ Clients      │
└──────────────┘
```

### User Trade Flow
```
Frontend (Portfolio Page)
        │
        │ Create Position
        │ (entry_price, shares, stop_loss, take_profit)
        │
Backend (POST /api/portfolio)
        │
        │ Validate
        │
Database (Insert into portfolios)
        │
        │ Response
        │
Frontend (Add to portfolio)
        │
        │ [Monitor]
        │
        │ Real-time Price Update (WebSocket)
        │
        │ Calculate P&L
        │
        │ Check Alerts (Stop Loss / Take Profit)
        │
        │ [Close Position]
        │
Backend (POST /api/portfolio/:id/close)
        │
Database (Update status, closed_at)
        │
Frontend (Remove from portfolio)
```

## Indicator Calculation Flow

### Moving Averages
```
Historical Prices (200 days)
        │
        ├─→ SMA 50:  Average of last 50 closes
        ├─→ SMA 200: Average of last 200 closes
        └─→ EMA 21:  Exponential average (weights recent prices)
```

### Momentum Indicators
```
Prices + Volumes
        │
        ├─→ RSI 14:  Strength index (0-100)
        │           overbought > 70
        │           oversold < 30
        │
        ├─→ MACD:    Trend following momentum
        │           MACD = EMA12 - EMA26
        │           Signal = EMA9(MACD)
        │           Histogram = MACD - Signal
        │
        └─→ OBV:     On-Balance Volume
                    Cumulative volume flow
```

### Volatility Indicators
```
High, Low, Close Prices
        │
        ├─→ Bollinger Bands:  Mean ± 2*StdDev
        │                    Identifies breakouts
        │
        └─→ ATR 14:         Average True Range
                            Volatility measure
```

## API Response Caching Strategy

```
Request → Check Cache (Redis)
           │
           ├─→ Hit (Found & Valid) → Return cached response
           │
           ├─→ Miss (Not found) → Fetch from Database
           │                    → Store in Cache
           │                    → Return response
           │
           └─→ Expired → Refresh & Update Cache
```

### Cache TTLs
- Stock data: 5 minutes
- Price data: 1 minute
- Indicators: 5 minutes
- Search results: 1 hour
- User sessions: 24 hours

## Scalability Design

### Horizontal Scaling
```
Load Balancer (nginx/HAProxy)
    │
    ├─→ Backend Instance 1
    ├─→ Backend Instance 2
    ├─→ Backend Instance 3
    └─→ Backend Instance N

Shared Resources:
    ├─→ PostgreSQL (Primary + Replicas)
    ├─→ Redis Cluster
    └─→ WebSocket Server (Sticky Sessions)
```

### Database Optimization
- Connection pooling with PgBouncer
- Read replicas for heavy queries
- Partitioning large tables by date
- Regular VACUUM and ANALYZE

### Frontend Optimization
- Code splitting by route
- Lazy loading components
- Bundle size: ~250KB (gzipped)
- Tree shaking unused code

## Security Architecture

```
Internet
   │
   └─→ Nginx (SSL/TLS Termination)
       │
       ├─→ CORS Validation
       ├─→ Rate Limiting
       └─→ WAF Rules
       │
       └─→ Express Backend
           │
           ├─→ Input Validation
           ├─→ JWT Authentication
           ├─→ RBAC (Role-Based Access)
           └─→ SQL Injection Prevention (Parameterized Queries)
           │
           └─→ PostgreSQL
               │
               └─→ Encrypted Connections
               └─→ Row-Level Security
```

## Monitoring & Observability

```
Application
    │
    ├─→ Logs
    │   ├─→ Application Logs (Winston/Pino)
    │   ├─→ Access Logs (nginx)
    │   └─→ Error Logs
    │
    ├─→ Metrics
    │   ├─→ API Response Time
    │   ├─→ Error Rate
    │   ├─→ Database Query Time
    │   └─→ Cache Hit Rate
    │
    └─→ Traces
        ├─→ Request Path
        ├─→ Database Operations
        └─→ External API Calls

Monitoring Tools (Production):
    ├─→ Datadog / New Relic (APM)
    ├─→ Prometheus (Metrics)
    ├─→ ELK Stack (Logs)
    └─→ Grafana (Dashboards)
```

## Deployment Architecture

### Development
```
Local Machine
├─→ Docker Compose (All services)
├─→ Hot reload (Frontend & Backend)
└─→ Local PostgreSQL
```

### Production
```
VPS / Cloud Platform
├─→ Docker Containers
├─→ Nginx Reverse Proxy
├─→ PostgreSQL (Managed or Self-hosted)
├─→ Redis (Managed or Self-hosted)
├─→ SSL/TLS Certificates
├─→ Automatic Backups
└─→ Monitoring & Alerts
```

## Error Handling & Recovery

```
Request
    │
    ├─→ Validation Error
    │   └─→ 400 Bad Request
    │
    ├─→ Authentication Error
    │   └─→ 401 Unauthorized
    │
    ├─→ Authorization Error
    │   └─→ 403 Forbidden
    │
    ├─→ Resource Not Found
    │   └─→ 404 Not Found
    │
    ├─→ Database Error
    │   ├─→ Retry Logic (3 attempts)
    │   └─→ 500 Internal Server Error
    │
    ├─→ API Service Error
    │   ├─→ Fallback to Cached Data
    │   └─→ 503 Service Unavailable
    │
    └─→ Network Error
        └─→ Reconnect with Exponential Backoff
```

## Performance Targets

| Metric | Target |
|--------|--------|
| API Response Time | < 200ms |
| Page Load Time | < 2s |
| Database Query | < 100ms |
| WebSocket Latency | < 50ms |
| Cache Hit Rate | > 80% |
| Uptime | 99.5% |

---

This architecture is designed for:
- **Scalability**: Easy horizontal scaling
- **Performance**: Optimized for speed and efficiency
- **Reliability**: High availability and disaster recovery
- **Security**: Defense in depth approach
- **Maintainability**: Clean separation of concerns
