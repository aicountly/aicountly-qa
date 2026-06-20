<?php

namespace App\Database\Seeds;

use CodeIgniter\CLI\CLI;
use CodeIgniter\Database\Seeder;

/**
 * Deterministic Books test data pack v1.
 *
 * Every name/reference includes a {QA_RUN_ID} placeholder that the worker substitutes
 * with the live QA-RUN-YYYYMMDD-NNNN before entering data through the UI.
 */
class BooksTestDataPackSeeder extends Seeder
{
    public function run(): void
    {
        $pack = [
            'product_name' => 'books',
            'pack_name'    => 'books-deterministic-v1',
            'module'       => 'all',
            'description'  => 'Deterministic Books master + transaction dataset for QA sessions. Names tagged with {QA_RUN_ID}.',
            'version'      => 1,
            'is_active'    => true,
            'data_json'    => json_encode($this->dataJson(), JSON_UNESCAPED_SLASHES),
            'created_at'   => date('Y-m-d H:i:s'),
            'updated_at'   => date('Y-m-d H:i:s'),
        ];

        $existing = $this->db->table('qa_test_data_packs')
            ->where('product_name', $pack['product_name'])
            ->where('pack_name', $pack['pack_name'])
            ->where('version', $pack['version'])
            ->get()->getRow();

        if ($existing) {
            CLI::write("Books test data pack v1 already seeded (id={$existing->id}).", 'yellow');
            return;
        }

        $this->db->table('qa_test_data_packs')->insert($pack);
        CLI::write('Seeded Books deterministic test data pack v1.', 'green');
    }

    private function dataJson(): array
    {
        return [
            'company' => [
                'name'         => '{QA_RUN_ID} Test Company Pvt Ltd',
                'gstin'        => '29ABCDE1234F1Z5',
                'pan'          => 'ABCDE1234F',
                'address1'     => 'No 1, MG Road',
                'city'         => 'Bengaluru',
                'state'        => 'Karnataka',
                'state_code'   => '29',
                'pincode'      => '560001',
                'country'      => 'India',
                'currency'     => 'INR',
                'books_begin'  => '2026-04-01',
            ],
            'branch' => [
                'name' => '{QA_RUN_ID} HO',
                'code' => '{QA_RUN_ID}-HO',
            ],
            'financial_year' => [
                'name'      => 'FY 2026-27',
                'start'     => '2026-04-01',
                'end'       => '2027-03-31',
            ],
            'account_groups' => [
                ['name' => 'Sundry Debtors',   'under' => 'Current Assets',      'nature' => 'Asset'],
                ['name' => 'Sundry Creditors', 'under' => 'Current Liabilities', 'nature' => 'Liability'],
                ['name' => 'Bank Accounts',    'under' => 'Current Assets',      'nature' => 'Asset'],
                ['name' => 'Cash-in-hand',     'under' => 'Current Assets',      'nature' => 'Asset'],
                ['name' => 'Sales Accounts',   'under' => 'Revenue',             'nature' => 'Income'],
                ['name' => 'Purchase Accounts','under' => 'Expenses',            'nature' => 'Expense'],
                ['name' => 'Duties & Taxes',   'under' => 'Current Liabilities', 'nature' => 'Liability'],
            ],
            'ledgers' => [
                ['name' => '{QA_RUN_ID} Customer A', 'group' => 'Sundry Debtors',   'gstin' => '29AAACA1111A1Z5', 'state' => 'Karnataka',  'opening' => 0],
                ['name' => '{QA_RUN_ID} Customer B', 'group' => 'Sundry Debtors',   'gstin' => '33BBACA2222B1Z5', 'state' => 'Tamil Nadu', 'opening' => 0],
                ['name' => '{QA_RUN_ID} Customer C', 'group' => 'Sundry Debtors',   'gstin' => null,              'state' => 'Karnataka',  'opening' => 0],
                ['name' => '{QA_RUN_ID} Supplier A', 'group' => 'Sundry Creditors', 'gstin' => '29CCDCA3333C1Z5', 'state' => 'Karnataka',  'opening' => 0],
                ['name' => '{QA_RUN_ID} Supplier B', 'group' => 'Sundry Creditors', 'gstin' => '27DDDCA4444D1Z5', 'state' => 'Maharashtra','opening' => 0],
                ['name' => '{QA_RUN_ID} Cash',       'group' => 'Cash-in-hand',     'gstin' => null,              'state' => null,         'opening' => 100000],
                ['name' => '{QA_RUN_ID} HDFC Bank',  'group' => 'Bank Accounts',    'gstin' => null,              'state' => null,         'opening' => 500000],
                ['name' => 'CGST Output',            'group' => 'Duties & Taxes',   'gstin' => null,              'state' => null,         'opening' => 0, 'tax' => ['kind' => 'CGST', 'rate' => null]],
                ['name' => 'SGST Output',            'group' => 'Duties & Taxes',   'gstin' => null,              'state' => null,         'opening' => 0, 'tax' => ['kind' => 'SGST', 'rate' => null]],
                ['name' => 'IGST Output',            'group' => 'Duties & Taxes',   'gstin' => null,              'state' => null,         'opening' => 0, 'tax' => ['kind' => 'IGST', 'rate' => null]],
                ['name' => 'CGST Input',             'group' => 'Duties & Taxes',   'gstin' => null,              'state' => null,         'opening' => 0, 'tax' => ['kind' => 'CGST', 'rate' => null]],
                ['name' => 'SGST Input',             'group' => 'Duties & Taxes',   'gstin' => null,              'state' => null,         'opening' => 0, 'tax' => ['kind' => 'SGST', 'rate' => null]],
                ['name' => 'IGST Input',             'group' => 'Duties & Taxes',   'gstin' => null,              'state' => null,         'opening' => 0, 'tax' => ['kind' => 'IGST', 'rate' => null]],
                ['name' => 'Sales @ 18%',            'group' => 'Sales Accounts',   'opening' => 0],
                ['name' => 'Sales @ 12%',            'group' => 'Sales Accounts',   'opening' => 0],
                ['name' => 'Purchase @ 18%',         'group' => 'Purchase Accounts','opening' => 0],
                ['name' => 'Purchase @ 12%',         'group' => 'Purchase Accounts','opening' => 0],
            ],
            'units' => [
                ['name' => 'NOS', 'description' => 'Numbers',  'decimals' => 0],
                ['name' => 'KG',  'description' => 'Kilogram', 'decimals' => 3],
                ['name' => 'BOX', 'description' => 'Box',      'decimals' => 0],
            ],
            'stock_categories' => [
                ['name' => '{QA_RUN_ID} Category A'],
                ['name' => '{QA_RUN_ID} Category B'],
            ],
            'items' => [
                ['name' => '{QA_RUN_ID} Product A', 'unit' => 'NOS', 'rate' => 100,  'gst_rate' => 18, 'hsn' => '9999', 'category' => '{QA_RUN_ID} Category A', 'opening_qty' => 0, 'opening_value' => 0],
                ['name' => '{QA_RUN_ID} Product B', 'unit' => 'NOS', 'rate' => 200,  'gst_rate' => 18, 'hsn' => '9999', 'category' => '{QA_RUN_ID} Category A', 'opening_qty' => 0, 'opening_value' => 0],
                ['name' => '{QA_RUN_ID} Product C', 'unit' => 'KG',  'rate' => 50,   'gst_rate' => 12, 'hsn' => '8888', 'category' => '{QA_RUN_ID} Category B', 'opening_qty' => 0, 'opening_value' => 0],
            ],
            'voucher_series' => [
                ['type' => 'Sales',    'prefix' => '{QA_RUN_ID}-SAL-', 'start' => 1],
                ['type' => 'Purchase', 'prefix' => '{QA_RUN_ID}-PUR-', 'start' => 1],
                ['type' => 'Payment',  'prefix' => '{QA_RUN_ID}-PAY-', 'start' => 1],
                ['type' => 'Receipt',  'prefix' => '{QA_RUN_ID}-RCT-', 'start' => 1],
                ['type' => 'Contra',   'prefix' => '{QA_RUN_ID}-CON-', 'start' => 1],
                ['type' => 'Journal',  'prefix' => '{QA_RUN_ID}-JNL-', 'start' => 1],
                ['type' => 'DebitNote','prefix' => '{QA_RUN_ID}-DN-',  'start' => 1],
                ['type' => 'CreditNote','prefix'=> '{QA_RUN_ID}-CN-',  'start' => 1],
                ['type' => 'Stock',    'prefix' => '{QA_RUN_ID}-STK-', 'start' => 1],
            ],
            'tax_categories' => [
                ['name' => 'GST 18%', 'rate' => 18, 'cgst' => 9, 'sgst' => 9, 'igst' => 18],
                ['name' => 'GST 12%', 'rate' => 12, 'cgst' => 6, 'sgst' => 6, 'igst' => 12],
            ],
            'sales_vouchers' => [
                [
                    'number'   => '{QA_RUN_ID}-SAL-001',
                    'date'     => '2026-04-05',
                    'party'    => '{QA_RUN_ID} Customer A',
                    'place_of_supply' => 'Karnataka',
                    'items'    => [
                        ['item' => '{QA_RUN_ID} Product A', 'qty' => 10, 'rate' => 100, 'gst_rate' => 18],
                    ],
                    'taxable'  => 1000,
                    'cgst'     => 90,
                    'sgst'     => 90,
                    'igst'     => 0,
                    'total'    => 1180,
                ],
                [
                    'number'   => '{QA_RUN_ID}-SAL-002',
                    'date'     => '2026-04-06',
                    'party'    => '{QA_RUN_ID} Customer B',
                    'place_of_supply' => 'Tamil Nadu',
                    'items'    => [
                        ['item' => '{QA_RUN_ID} Product B', 'qty' => 5, 'rate' => 200, 'gst_rate' => 18],
                    ],
                    'taxable'  => 1000,
                    'cgst'     => 0,
                    'sgst'     => 0,
                    'igst'     => 180,
                    'total'    => 1180,
                ],
                [
                    'number'   => '{QA_RUN_ID}-SAL-003',
                    'date'     => '2026-04-07',
                    'party'    => '{QA_RUN_ID} Customer C',
                    'place_of_supply' => 'Karnataka',
                    'items'    => [
                        ['item' => '{QA_RUN_ID} Product C', 'qty' => 20, 'rate' => 50, 'gst_rate' => 12],
                    ],
                    'taxable'  => 1000,
                    'cgst'     => 60,
                    'sgst'     => 60,
                    'igst'     => 0,
                    'total'    => 1120,
                ],
            ],
            'purchase_vouchers' => [
                [
                    'number'   => '{QA_RUN_ID}-PUR-001',
                    'date'     => '2026-04-02',
                    'party'    => '{QA_RUN_ID} Supplier A',
                    'place_of_supply' => 'Karnataka',
                    'items'    => [
                        ['item' => '{QA_RUN_ID} Product A', 'qty' => 50, 'rate' => 80, 'gst_rate' => 18],
                    ],
                    'taxable'  => 4000,
                    'cgst'     => 360,
                    'sgst'     => 360,
                    'igst'     => 0,
                    'total'    => 4720,
                ],
                [
                    'number'   => '{QA_RUN_ID}-PUR-002',
                    'date'     => '2026-04-03',
                    'party'    => '{QA_RUN_ID} Supplier B',
                    'place_of_supply' => 'Maharashtra',
                    'items'    => [
                        ['item' => '{QA_RUN_ID} Product B', 'qty' => 25, 'rate' => 160, 'gst_rate' => 18],
                    ],
                    'taxable'  => 4000,
                    'cgst'     => 0,
                    'sgst'     => 0,
                    'igst'     => 720,
                    'total'    => 4720,
                ],
            ],
            'payment_vouchers' => [
                [
                    'number' => '{QA_RUN_ID}-PAY-001',
                    'date'   => '2026-04-10',
                    'from'   => '{QA_RUN_ID} HDFC Bank',
                    'to'     => '{QA_RUN_ID} Supplier A',
                    'amount' => 4720,
                    'mode'   => 'NEFT',
                    'narration' => 'QA test payment to Supplier A',
                ],
            ],
            'receipt_vouchers' => [
                [
                    'number' => '{QA_RUN_ID}-RCT-001',
                    'date'   => '2026-04-11',
                    'from'   => '{QA_RUN_ID} Customer A',
                    'to'     => '{QA_RUN_ID} HDFC Bank',
                    'amount' => 1180,
                    'mode'   => 'NEFT',
                    'narration' => 'QA test receipt from Customer A',
                ],
            ],
            'contra_vouchers' => [
                [
                    'number' => '{QA_RUN_ID}-CON-001',
                    'date'   => '2026-04-12',
                    'from'   => '{QA_RUN_ID} HDFC Bank',
                    'to'     => '{QA_RUN_ID} Cash',
                    'amount' => 10000,
                    'narration' => 'QA test cash withdrawal',
                ],
            ],
            'journal_vouchers' => [
                [
                    'number' => '{QA_RUN_ID}-JNL-001',
                    'date'   => '2026-04-13',
                    'narration' => 'QA test journal',
                    'entries' => [
                        ['ledger' => 'CGST Output', 'dr' => 0, 'cr' => 0],
                    ],
                ],
            ],
            'debit_notes' => [
                [
                    'number' => '{QA_RUN_ID}-DN-001',
                    'date'   => '2026-04-14',
                    'party'  => '{QA_RUN_ID} Supplier A',
                    'taxable' => 100,
                    'cgst' => 9,
                    'sgst' => 9,
                    'igst' => 0,
                    'total' => 118,
                    'narration' => 'QA test debit note (returned 1 unit of Product A)',
                    'items' => [['item' => '{QA_RUN_ID} Product A', 'qty' => 1, 'rate' => 80, 'gst_rate' => 18]],
                ],
            ],
            'credit_notes' => [
                [
                    'number' => '{QA_RUN_ID}-CN-001',
                    'date'   => '2026-04-15',
                    'party'  => '{QA_RUN_ID} Customer A',
                    'taxable' => 100,
                    'cgst' => 9,
                    'sgst' => 9,
                    'igst' => 0,
                    'total' => 118,
                    'narration' => 'QA test credit note (returned 1 unit of Product A)',
                    'items' => [['item' => '{QA_RUN_ID} Product A', 'qty' => 1, 'rate' => 100, 'gst_rate' => 18]],
                ],
            ],
            'stock_vouchers' => [
                [
                    'number' => '{QA_RUN_ID}-STK-001',
                    'date'   => '2026-04-16',
                    'kind'   => 'StockJournal',
                    'narration' => 'QA stock adjustment',
                    'items' => [['item' => '{QA_RUN_ID} Product C', 'qty' => 0, 'rate' => 50]],
                ],
            ],
        ];
    }
}
