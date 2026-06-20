<?php

namespace App\Database\Seeds;

use CodeIgniter\CLI\CLI;
use CodeIgniter\Database\Seeder;

/**
 * Expected reconciliation results for the Books deterministic v1 pack.
 * Values are derived from the BooksTestDataPackSeeder dataset.
 *
 * Sales: 1000 + 1000 + 1000 = 3000 taxable
 *   Output GST: (90+90) + 180 + (60+60) = 480 → CGST 150 + SGST 150 + IGST 180
 *
 * Purchases: 4000 + 4000 = 8000 taxable
 *   Input GST: (360+360) + 720 = 1440 → CGST 360 + SGST 360 + IGST 720
 *
 * Debit Note (returned to Supplier A): -100 taxable, -18 input GST
 * Credit Note (returned by Customer A): -100 taxable, -18 output GST
 *
 * Customer outstanding (A) = 1180 - 1180 receipt - 118 credit note = -118 (overpayment)
 *   (kept simple; reconciliation engine handles tolerance)
 * Cash opening 100,000 + 10,000 contra = 110,000
 * Bank opening 500,000 - 4,720 payment + 1,180 receipt - 10,000 contra = 486,460
 *
 * Stock movement Product A:
 *   In  = 50 (PUR-001)
 *   Out = 10 (SAL-001) + 1 (CN-001 inward)? credit note adds back stock = 1 in
 *       Net Out = 10
 *   Returned = 1 (DN-001 outward back to supplier) = 1 out
 *   Closing qty = 50 - 10 - 1 + 1 = 40
 */
class BooksExpectedResultsSeeder extends Seeder
{
    public function run(): void
    {
        $pack = $this->db->table('qa_test_data_packs')
            ->where('product_name', 'books')
            ->where('pack_name', 'books-deterministic-v1')
            ->get()->getRow();

        if (! $pack) {
            CLI::write('BooksTestDataPackSeeder must run before BooksExpectedResultsSeeder.', 'red');
            return;
        }

        $rows = [
            ['metric_key' => 'taxable_sales',         'metric_label' => 'Taxable Sales',                'expected_value_json' => json_encode(['value' => 3000])],
            ['metric_key' => 'output_cgst',           'metric_label' => 'Output CGST',                  'expected_value_json' => json_encode(['value' => 150])],
            ['metric_key' => 'output_sgst',           'metric_label' => 'Output SGST',                  'expected_value_json' => json_encode(['value' => 150])],
            ['metric_key' => 'output_igst',           'metric_label' => 'Output IGST',                  'expected_value_json' => json_encode(['value' => 180])],
            ['metric_key' => 'output_gst_total',      'metric_label' => 'Output GST Total',             'expected_value_json' => json_encode(['value' => 480])],

            ['metric_key' => 'taxable_purchases',     'metric_label' => 'Taxable Purchases',            'expected_value_json' => json_encode(['value' => 8000])],
            ['metric_key' => 'input_cgst',            'metric_label' => 'Input CGST',                   'expected_value_json' => json_encode(['value' => 360])],
            ['metric_key' => 'input_sgst',            'metric_label' => 'Input SGST',                   'expected_value_json' => json_encode(['value' => 360])],
            ['metric_key' => 'input_igst',            'metric_label' => 'Input IGST',                   'expected_value_json' => json_encode(['value' => 720])],
            ['metric_key' => 'input_gst_total',       'metric_label' => 'Input GST Total',              'expected_value_json' => json_encode(['value' => 1440])],

            ['metric_key' => 'customer_outstanding',  'metric_label' => 'Total Customer Outstanding',   'expected_value_json' => json_encode(['value' => 2182, 'by_party' => [
                '{QA_RUN_ID} Customer A' => -118,
                '{QA_RUN_ID} Customer B' => 1180,
                '{QA_RUN_ID} Customer C' => 1120,
            ]])],
            ['metric_key' => 'supplier_outstanding',  'metric_label' => 'Total Supplier Outstanding',   'expected_value_json' => json_encode(['value' => 4602, 'by_party' => [
                '{QA_RUN_ID} Supplier A' => -118,
                '{QA_RUN_ID} Supplier B' => 4720,
            ]])],

            ['metric_key' => 'cash_balance',          'metric_label' => 'Cash in Hand (closing)',       'expected_value_json' => json_encode(['value' => 110000])],
            ['metric_key' => 'bank_balance',          'metric_label' => 'HDFC Bank (closing)',          'expected_value_json' => json_encode(['value' => 486460])],

            ['metric_key' => 'item_qty_in',           'metric_label' => 'Item Inward Quantity',         'expected_value_json' => json_encode([
                '{QA_RUN_ID} Product A' => 50,
                '{QA_RUN_ID} Product B' => 25,
                '{QA_RUN_ID} Product C' => 0,
            ])],
            ['metric_key' => 'item_qty_out',          'metric_label' => 'Item Outward Quantity',        'expected_value_json' => json_encode([
                '{QA_RUN_ID} Product A' => 10,
                '{QA_RUN_ID} Product B' => 5,
                '{QA_RUN_ID} Product C' => 20,
            ])],
            ['metric_key' => 'closing_stock_qty',     'metric_label' => 'Closing Stock Quantity',       'expected_value_json' => json_encode([
                '{QA_RUN_ID} Product A' => 40,
                '{QA_RUN_ID} Product B' => 20,
                '{QA_RUN_ID} Product C' => -20,
            ])],
            ['metric_key' => 'closing_stock_value',   'metric_label' => 'Closing Stock Value',          'expected_value_json' => json_encode(['value' => 7200, 'method' => 'weighted-purchase-rate'])],

            ['metric_key' => 'gross_profit',          'metric_label' => 'Gross Profit',                 'expected_value_json' => json_encode(['value' => 200, 'note' => 'sales 3000 - cogs 2800 (purchases consumed)'])],
            ['metric_key' => 'net_profit',            'metric_label' => 'Net Profit',                   'expected_value_json' => json_encode(['value' => 200])],

            ['metric_key' => 'tb_debit_total',        'metric_label' => 'Trial Balance Debit Total',    'expected_value_json' => json_encode(['equals' => 'credit_total'])],
            ['metric_key' => 'tb_credit_total',       'metric_label' => 'Trial Balance Credit Total',   'expected_value_json' => json_encode(['equals' => 'debit_total'])],

            ['metric_key' => 'bs_asset_total',        'metric_label' => 'Balance Sheet Assets',         'expected_value_json' => json_encode(['equals' => 'liability_total'])],
            ['metric_key' => 'bs_liability_total',    'metric_label' => 'Balance Sheet Liabilities',    'expected_value_json' => json_encode(['equals' => 'asset_total'])],

            ['metric_key' => 'sales_voucher_count',   'metric_label' => 'Sales Voucher Count',          'expected_value_json' => json_encode(['value' => 3])],
            ['metric_key' => 'purchase_voucher_count','metric_label' => 'Purchase Voucher Count',       'expected_value_json' => json_encode(['value' => 2])],
        ];

        $now = date('Y-m-d H:i:s');
        foreach ($rows as &$row) {
            $row['pack_id']    = $pack->id;
            $row['tolerance']  = 1;
            $row['created_at'] = $now;
        }

        $this->db->table('qa_expected_results')->ignore(true)->insertBatch($rows);
        CLI::write('Seeded Books expected results.', 'green');
    }
}
