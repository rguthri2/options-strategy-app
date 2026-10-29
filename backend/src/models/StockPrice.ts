import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Stock } from './Stock';

@Entity('stock_prices')
@Index(['stock_id', 'timestamp'], { unique: true })
@Index(['timestamp'])
export class StockPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  stock_id: string;

  @ManyToOne(() => Stock, (stock) => stock.prices, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stock_id' })
  stock: Stock;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  open: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  high: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  low: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  close: number;

  @Column({ type: 'bigint' })
  volume: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  vwap: number;

  @Column({ type: 'varchar', default: '1d' })
  interval: string; // 1m, 5m, 15m, 1h, 1d

  @CreateDateColumn()
  created_at: Date;
}
