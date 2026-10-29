import { DataSource } from 'typeorm';
import * as path from 'path';
import { Stock } from '@/models/Stock';
import { StockPrice } from '@/models/StockPrice';
import { TechnicalIndicator } from '@/models/TechnicalIndicator';
import { UserAlert } from '@/models/UserAlert';
import { Portfolio } from '@/models/Portfolio';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'trading_user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'trading_platform',
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  entities: [Stock, StockPrice, TechnicalIndicator, UserAlert, Portfolio],
  migrations: [path.join(__dirname, '../migrations/**/*.{ts,js}')],
  subscribers: [],
});
