# Options Strategy Trading Platform

A professional, real-time stock options trading platform with advanced technical analysis, live charting, and automated scanning.

## 🚀 Features

### Core Features
- **Real-time Data Integration**: Live stock prices, volumes, and market data from Finnhub
- **Advanced Charting**: TradingView-style interactive charts with Lightweight Charts
- **Technical Indicators**: 
  - Moving Averages (EMA 21, MA 50, MA 200)
  - RSI (Relative Strength Index)
  - MACD (Moving Average Convergence Divergence)
  - Bollinger Bands
  - ATR (Average True Range)
  - OBV (On-Balance Volume)

### Scanning & Pattern Recognition
- **Breakout Scanner**: Identify stocks breaking out from key resistance levels
- **Gap Scanner**: Find gap opportunities
- **Reversal Scanner**: Detect potential trend reversals
- **Volume Analysis**: Track volume trends and anomalies

### Portfolio Management
- Track open positions
- Set stop loss and take profit levels
- Monitor P&L in real-time
- Position sizing and risk management

### Alerts & Notifications
- Price alerts
- Volume alerts
- Technical indicator alerts
- Pattern detection alerts

## 🛠️ Tech Stack

### Frontend
- **React 18** with TypeScript
- **Lightweight Charts** - TradingView-style charting
- **Axios** - HTTP client
- **Socket.IO Client** - Real-time updates
- **Zustand** - State management
- **CSS3** - Modern styling

### Backend
- **Node.js** with Express.js and TypeScript
- **PostgreSQL** - Relational database
- **TypeORM** - Database ORM
- **Finnhub API** - Real-time market data
- **Socket.IO** - WebSocket server
- **Redis** - Caching layer

### Infrastructure
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL 12+
- Docker & Docker Compose (optional)
- Finnhub API Key (free tier available at https://finnhub.io)

## 🚀 Quick Start

### Option 1: Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repository>
cd options-trading-app

# Create environment file
cp backend/.env.example backend/.env

# Add your Finnhub API key to backend/.env
# FINNHUB_API_KEY=your_api_key_here

# Start all services
docker-compose up -d

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:5000
# Database: localhost:5432
```

### Option 2: Local Development

#### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Add your Finnhub API key
# Update database credentials in .env

# Run migrations
npm run migrations

# Start development server
npm run dev
```

#### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env file
echo "REACT_APP_API_URL=http://localhost:5000/api" > .env
echo "REACT_APP_SOCKET_URL=http://localhost:5000" >> .env

# Start development server
npm start
```

## 📚 API Documentation

### Stocks Endpoints
- `GET /api/stocks` - Get all active stocks
- `GET /api/stocks/:symbol` - Get specific stock
- `GET /api/stocks/search/:query` - Search stocks
- `POST /api/stocks/update/:symbol` - Update stock data
- `GET /api/stocks/sector/:sector` - Get stocks by sector
- `GET /api/stocks/top/movers` - Get top moving stocks

### Prices Endpoints
- `GET /api/prices/:symbol` - Get historical prices
- `GET /api/prices/:symbol/candles` - Get OHLCV candles
- `GET /api/prices/:symbol/latest` - Get latest price

### Indicators Endpoints
- `GET /api/indicators/:symbol` - Get latest indicators
- `GET /api/indicators/:symbol/history` - Get indicator history
- `GET /api/indicators/scan/breakouts` - Scan for breakouts
- `GET /api/indicators/scan/gaps` - Scan for gaps
- `GET /api/indicators/scan/reversals` - Scan for reversals

### Portfolio Endpoints
- `GET /api/portfolio/:userId` - Get user positions
- `POST /api/portfolio` - Create new position
- `PUT /api/portfolio/:id` - Update position
- `POST /api/portfolio/:id/close` - Close position

### Alerts Endpoints
- `GET /api/alerts/:userId` - Get user alerts
- `POST /api/alerts` - Create alert
- `DELETE /api/alerts/:id` - Delete alert

## 🔧 Configuration

### Environment Variables

**Backend (.env)**
```
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_USER=trading_user
DB_PASSWORD=your_secure_password
DB_NAME=trading_platform
FINNHUB_API_KEY=your_finnhub_api_key
JWT_SECRET=your_jwt_secret
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3000
```

**Frontend (.env)**
```
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_SOCKET_URL=http://localhost:5000
```

## 📦 Database Schema

### Tables
- `stocks` - Stock master data
- `stock_prices` - OHLCV price data
- `technical_indicators` - Calculated technical indicators
- `portfolios` - User positions
- `user_alerts` - User alerts and notifications

## 🌐 Deployment to VPS

### Prerequisites
- SSH access to your VPS
- Docker and Docker Compose installed

### Deployment Steps

```bash
# 1. SSH into your VPS
ssh root@70.36.114.244

# 2. Clone the repository
git clone <repository>
cd options-trading-app

# 3. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys and configuration

# 4. Build and start containers
docker-compose up -d --build

# 5. Setup SSL (optional but recommended)
# Use Let's Encrypt with Nginx reverse proxy

# 6. Configure firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Reverse Proxy Configuration (Nginx)

```nginx
upstream trading_backend {
    server localhost:5000;
}

upstream trading_frontend {
    server localhost:3000;
}

server {
    listen 80;
    server_name your_domain.com;

    location /api {
        proxy_pass http://trading_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://trading_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 📊 Usage Examples

### Viewing a Stock
1. Navigate to Dashboard
2. Click on a stock symbol to view detailed analysis
3. Chart displays real-time price data
4. Technical indicators show current values
5. Pattern indicators highlight breakouts, gaps, and reversals

### Using the Scanner
1. Go to Scanner section
2. Select scan type (Breakouts, Gaps, or Reversals)
3. View matching opportunities
4. Click "Analyze" to view detailed chart

### Managing Portfolio
1. Navigate to Portfolio
2. View all open positions
3. Edit stop loss/take profit
4. Close positions as needed
5. Track P&L in real-time

## 🔐 Security Best Practices

- Use environment variables for sensitive data
- Keep API keys secure and never commit them
- Use HTTPS in production
- Implement CORS properly
- Validate all user inputs
- Use strong JWT secrets
- Regularly update dependencies

## 📈 Performance Optimization

- Redis caching for frequently accessed data
- Database indexing on frequently queried columns
- WebSocket for real-time updates instead of polling
- Lazy loading of components
- Image optimization

## 🐛 Troubleshooting

### Cannot connect to database
- Verify PostgreSQL is running
- Check database credentials in .env
- Ensure database exists

### WebSocket connection fails
- Check CORS configuration
- Verify Socket.IO port is accessible
- Check firewall settings

### Finnhub API errors
- Verify API key is correct
- Check API rate limits
- Ensure network connectivity

## 📝 License

This project is licensed under the MIT License.

## 🤝 Support

For issues and questions, please open an issue on the repository.

## 🔄 Updates & Maintenance

```bash
# Update dependencies
npm update

# Check for vulnerabilities
npm audit

# Run tests
npm test

# Build for production
npm run build
```

## 📞 Contact & Documentation

For detailed documentation and API references, visit the docs folder.
