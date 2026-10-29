import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('portfolios')
@Index(['user_id', 'symbol'])
export class Portfolio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column()
  symbol: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  entry_price: number;

  @Column({ type: 'integer' })
  shares: number;

  @Column({ type: 'varchar' })
  position_type: string; // 'long' or 'short'

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  stop_loss: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  take_profit: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  current_price: number;

  @Column({ type: 'varchar', default: 'open' })
  status: string; // 'open', 'closed', 'pending'

  @CreateDateColumn()
  opened_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  closed_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
