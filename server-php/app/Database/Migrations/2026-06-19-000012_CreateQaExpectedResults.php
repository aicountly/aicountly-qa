<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaExpectedResults extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                  => ['type' => 'BIGSERIAL'],
            'pack_id'             => ['type' => 'BIGINT', 'null' => false],
            'metric_key'          => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => false],
            // taxable_sales, output_gst, taxable_purchases, input_gst, customer_outstanding,
            // supplier_outstanding, cash_balance, bank_balance, item_qty_in, item_qty_out,
            // closing_stock_qty, closing_stock_value, gross_profit, net_profit,
            // tb_debit_total, tb_credit_total, bs_asset_total, bs_liability_total
            'metric_label'        => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => true],
            'expected_value_json' => ['type' => 'JSONB', 'null' => false],
            'tolerance'           => ['type' => 'NUMERIC', 'constraint' => '18,4', 'default' => 0],
            'created_at'          => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey(['pack_id', 'metric_key']);
        $this->forge->addForeignKey('pack_id', 'qa_test_data_packs', 'id', 'CASCADE', 'CASCADE');
        $this->forge->createTable('qa_expected_results', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_expected_results', true);
    }
}
