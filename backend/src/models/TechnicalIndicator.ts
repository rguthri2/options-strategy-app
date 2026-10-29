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

@Entity('technical_indicators')
@Index(['stock_id', 'timestamp'])
export class TechnicalIndicator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  stock_id: string;

  @ManyToOne(() => Stock, (stock) => stock.indicators, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stock_id' })
  stock: Stock;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  // Moving Averages
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  ema_21: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  ma_50: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  ma_200: number;

  // Momentum Indicators
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  rsi_14: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  macd: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  macd_signal: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  macd_histogram: number;

  // Bollinger Bands
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  bb_upper: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  bb_middle: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  bb_lower: number;

  // ATR & Volatility
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  atr_14: number;

  // Volume Indicators
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  obv: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  ad_line: number;

  // Pattern Recognition
  @Column({ type: 'varchar', nullable: true })
  pattern: string; // breakout, gap, reversal, etc.

  @Column({ type: 'boolean', default: false })
  is_breakout: boolean;

  @Column({ type: 'boolean', default: false })
  is_gap: boolean;

  @Column({ type: 'boolean', default: false })
  is_reversal: boolean;

  @CreateDateColumn()
  created_at: Date;
}
