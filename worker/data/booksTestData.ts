/**
 * Standalone Books deterministic dataset used as a fallback when the worker
 * can't reach the API or runs scripts without a server (e.g. `qa:books` smoke).
 *
 * The canonical version lives in the DB (BooksTestDataPackSeeder).
 */

export const booksFallback = {
  company: {
    name: '{QA_RUN_ID} Test Company Pvt Ltd',
    gstin: '29ABCDE1234F1Z5',
    state: 'Karnataka',
    state_code: '29',
    currency: 'INR',
    books_begin: '2026-04-01',
  },
  branch: { name: '{QA_RUN_ID} HO', code: '{QA_RUN_ID}-HO' },
  financial_year: { name: 'FY 2026-27', start: '2026-04-01', end: '2027-03-31' },
  account_groups: [
    { name: 'Sundry Debtors',   under: 'Current Assets',      nature: 'Asset' },
    { name: 'Sundry Creditors', under: 'Current Liabilities', nature: 'Liability' },
    { name: 'Bank Accounts',    under: 'Current Assets',      nature: 'Asset' },
    { name: 'Cash-in-hand',     under: 'Current Assets',      nature: 'Asset' },
    { name: 'Sales Accounts',   under: 'Revenue',             nature: 'Income' },
    { name: 'Purchase Accounts',under: 'Expenses',            nature: 'Expense' },
    { name: 'Duties & Taxes',   under: 'Current Liabilities', nature: 'Liability' },
  ],
  ledgers: [
    { name: '{QA_RUN_ID} Customer A', group: 'Sundry Debtors',   gstin: '29AAACA1111A1Z5', state: 'Karnataka',  opening: 0 },
    { name: '{QA_RUN_ID} Customer B', group: 'Sundry Debtors',   gstin: '33BBACA2222B1Z5', state: 'Tamil Nadu', opening: 0 },
    { name: '{QA_RUN_ID} Supplier A', group: 'Sundry Creditors', gstin: '29CCDCA3333C1Z5', state: 'Karnataka',  opening: 0 },
    { name: '{QA_RUN_ID} HDFC Bank',  group: 'Bank Accounts',    opening: 500000 },
    { name: '{QA_RUN_ID} Cash',       group: 'Cash-in-hand',     opening: 100000 },
  ],
  items: [
    { name: '{QA_RUN_ID} Product A', unit: 'NOS', rate: 100, gst_rate: 18, hsn: '9999' },
    { name: '{QA_RUN_ID} Product B', unit: 'NOS', rate: 200, gst_rate: 18, hsn: '9999' },
    { name: '{QA_RUN_ID} Product C', unit: 'KG',  rate: 50,  gst_rate: 12, hsn: '8888' },
  ],
  sales_vouchers: [
    { number: '{QA_RUN_ID}-SAL-001', date: '2026-04-05', party: '{QA_RUN_ID} Customer A', taxable: 1000, cgst: 90,  sgst: 90,  igst: 0,   total: 1180,
      items: [{ item: '{QA_RUN_ID} Product A', qty: 10, rate: 100, gst_rate: 18 }] },
    { number: '{QA_RUN_ID}-SAL-002', date: '2026-04-06', party: '{QA_RUN_ID} Customer B', taxable: 1000, cgst: 0,   sgst: 0,   igst: 180, total: 1180,
      items: [{ item: '{QA_RUN_ID} Product B', qty: 5,  rate: 200, gst_rate: 18 }] },
  ],
  purchase_vouchers: [
    { number: '{QA_RUN_ID}-PUR-001', date: '2026-04-02', party: '{QA_RUN_ID} Supplier A', taxable: 4000, cgst: 360, sgst: 360, igst: 0,   total: 4720,
      items: [{ item: '{QA_RUN_ID} Product A', qty: 50, rate: 80, gst_rate: 18 }] },
  ],
} as const
