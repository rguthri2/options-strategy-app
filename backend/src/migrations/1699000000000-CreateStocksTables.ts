import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateStocksTables1699000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create stocks table
    await queryRunner.createTable(
      new Table({
        name: 'stocks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'symbol',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'name',
            type: 'varchar',
          },
          {
            name: 'exchange',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'sector',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'industry',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'market_cap',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'price',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'previous_close',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'volume',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'avg_volume_30d',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'pe_ratio',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'dividend_yield',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'week_52_high',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'week_52_low',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            columnNames: ['symbol'],
            isUnique: true,
          },
          {
            columnNames: ['sector'],
          },
          {
            columnNames: ['market_cap'],
          },
        ],
      })
    );

    // Create stock_prices table
    await queryRunner.createTable(
      new Table({
        name: 'stock_prices',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'stock_id',
            type: 'uuid',
          },
          {
            name: 'timestamp',
            type: 'timestamp',
          },
          {
            name: 'open',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'high',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'low',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'close',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'volume',
            type: 'bigint',
          },
          {
            name: 'vwap',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'interval',
            type: 'varchar',
            default: "'1d'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['stock_id'],
            referencedTableName: 'stocks',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            columnNames: ['stock_id', 'timestamp'],
            isUnique: true,
          },
          {
            columnNames: ['timestamp'],
          },
        ],
      })
    );

    // Create technical_indicators table
    await queryRunner.createTable(
      new Table({
        name: 'technical_indicators',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'stock_id',
            type: 'uuid',
          },
          {
            name: 'timestamp',
            type: 'timestamp',
          },
          {
            name: 'ema_21',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'ma_50',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'ma_200',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'rsi_14',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'macd',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'macd_signal',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'macd_histogram',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'bb_upper',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'bb_middle',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'bb_lower',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'atr_14',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'obv',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'ad_line',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'pattern',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'is_breakout',
            type: 'boolean',
            default: false,
          },
          {
            name: 'is_gap',
            type: 'boolean',
            default: false,
          },
          {
            name: 'is_reversal',
            type: 'boolean',
            default: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['stock_id'],
            referencedTableName: 'stocks',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            columnNames: ['stock_id', 'timestamp'],
          },
        ],
      })
    );

    // Create portfolios table
    await queryRunner.createTable(
      new Table({
        name: 'portfolios',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'varchar',
          },
          {
            name: 'symbol',
            type: 'varchar',
          },
          {
            name: 'entry_price',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'shares',
            type: 'integer',
          },
          {
            name: 'position_type',
            type: 'varchar',
          },
          {
            name: 'stop_loss',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'take_profit',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'current_price',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            default: "'open'",
          },
          {
            name: 'opened_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'closed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            columnNames: ['user_id', 'symbol'],
          },
        ],
      })
    );

    // Create user_alerts table
    await queryRunner.createTable(
      new Table({
        name: 'user_alerts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'varchar',
          },
          {
            name: 'symbol',
            type: 'varchar',
          },
          {
            name: 'alert_type',
            type: 'varchar',
          },
          {
            name: 'trigger_price',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'trigger_condition',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'is_triggered',
            type: 'boolean',
            default: false,
          },
          {
            name: 'triggered_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            columnNames: ['user_id', 'symbol'],
          },
        ],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_alerts');
    await queryRunner.dropTable('portfolios');
    await queryRunner.dropTable('technical_indicators');
    await queryRunner.dropTable('stock_prices');
    await queryRunner.dropTable('stocks');
  }
}
