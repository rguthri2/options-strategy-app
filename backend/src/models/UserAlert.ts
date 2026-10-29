import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_alerts')
@Index(['user_id', 'symbol'])
export class UserAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column()
  symbol: string;

  @Column({ type: 'varchar' })
  alert_type: string; // 'price', 'volume', 'breakout', 'rsi', 'macd'

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  trigger_price: number;

  @Column({ type: 'varchar', nullable: true })
  trigger_condition: string; // 'above', 'below', 'crosses'

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: false })
  is_triggered: boolean;

  @Column({ type: 'timestamp', nullable: true })
  triggered_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
