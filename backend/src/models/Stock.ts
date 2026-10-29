import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { StockPrice } from './StockPrice';
import { TechnicalIndicator } from './TechnicalIndicator';

@Entity('stocks')
@Index(['symbol'], { unique: true })
@Index(['sector'])
@Index(['market_cap'])
export class Stock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  symbol: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  exchange: string;

  @Column({ nullable: true })
  sector: string;

  @Column({ nullable: true })
  industry: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  market_cap: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  previous_close: number;

  @Column({ type: 'bigint', nullable: true })
  volume: number;

  @Column({ type: 'bigint', nullable: true })
  avg_volume_30d: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  pe_ratio: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  dividend_yield: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  week_52_high: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  week_52_low: number;

  @Column({ type: 'boolean', default: false })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => StockPrice, (price) => price.stock)
  prices: StockPrice[];

  @OneToMany(() => TechnicalIndicator, (indicator) => indicator.stock)
  indicators: TechnicalIndicator[];
}
