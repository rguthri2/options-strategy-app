import 'dotenv/config';
import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { AppDataSource } from '@/config/database';
import stockRoutes from '@/routes/stocks';
import priceRoutes from '@/routes/prices';
import indicatorRoutes from '@/routes/indicators';
import portfolioRoutes from '@/routes/portfolio';
import alertRoutes from '@/routes/alerts';
import scannerRoutes from '@/routes/scanner';
import { finnhubService } from '@/services/finnhubService';
import { technicalAnalysisService } from '@/services/technicalAnalysisService';

dotenv.config();

// Return NUMERIC and BIGINT columns as numbers so the frontend can format them
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { types } = require('pg');
types.setTypeParser(1700, (v: string) => parseFloat(v));
types.setTypeParser(20, (v: string) => parseInt(v, 10));

const app: Express = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/stocks', stockRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/indicators', indicatorRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/scanner', scannerRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Initialize Database and Start Server
async function initializeApp() {
  try {
    // Initialize database
    await AppDataSource.initialize();
    console.log('Database connected successfully');

    // Start server
    httpServer.listen(PORT, () => {
      console.log(`🚀 Trading Platform Backend running on http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Initialize services
    finnhubService.initialize(process.env.FINNHUB_API_KEY || '');
    technicalAnalysisService.initialize();

    // WebSocket connections
    io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);

      socket.on('subscribe_stock', (symbol: string) => {
        socket.join(`stock:${symbol}`);
        console.log(`Client ${socket.id} subscribed to ${symbol}`);
      });

      socket.on('unsubscribe_stock', (symbol: string) => {
        socket.leave(`stock:${symbol}`);
      });

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });

    // Attach io to app for use in routes
    (app as any).io = io;
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

initializeApp();

export { app, io };
