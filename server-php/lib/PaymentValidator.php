<?php

declare(strict_types=1);

final class PaymentValidator
{
    public static function validateCreatePayload(array $payload): array
    {
        $honeypot = trim((string) ($payload['website'] ?? ''));
        $company = trim((string) ($payload['company'] ?? ''));

        if ($honeypot !== '' || $company !== '') {
            Response::error('Request rejected', 400);
        }

        $clientName = InputGuard::sanitizeClientName((string) ($payload['client_name'] ?? ''));
        $projectName = InputGuard::sanitizeProjectName((string) ($payload['project_name'] ?? ''));
        $invoiceRef = InputGuard::sanitizeInvoiceRef((string) ($payload['invoice_ref'] ?? ''));
        $currency = strtoupper(trim((string) ($payload['currency'] ?? '')));
        $amountRaw = $payload['amount'] ?? null;

        $donorName = InputGuard::sanitizeDonorName((string) ($payload['donor_name'] ?? ''));
        $donorEmail = InputGuard::sanitizeEmail((string) ($payload['donor_email'] ?? ''));
        $donorPhone = InputGuard::sanitizePhone((string) ($payload['donor_phone'] ?? ''));
        $donorPan = InputGuard::sanitizePan((string) ($payload['donor_pan'] ?? ''));

        InputGuard::assertSafe($clientName, 'client_name');
        InputGuard::assertSafe($projectName, 'project_name');
        InputGuard::assertSafe($invoiceRef, 'invoice_ref');
        InputGuard::assertSafe($donorName, 'donor_name');
        InputGuard::assertSafe($donorEmail, 'donor_email');
        InputGuard::assertSafe($donorPhone, 'donor_phone');
        InputGuard::assertSafe($donorPan, 'donor_pan');

        if ($clientName === '' || mb_strlen($clientName) < 2 || mb_strlen($clientName) > 200) {
            Response::error('Client name must be 2–200 characters (letters and numbers only)', 422);
        }

        if (!preg_match('/^[\p{L}\p{N} ]+$/u', $clientName)) {
            Response::error('Client name can only contain letters, numbers, and spaces', 422);
        }

        if ($projectName === '' || mb_strlen($projectName) < 2 || mb_strlen($projectName) > 200) {
            Response::error('Project name must be 2–200 characters (letters and numbers only)', 422);
        }

        if (!preg_match('/^[\p{L}\p{N} ]+$/u', $projectName)) {
            Response::error('Project name can only contain letters, numbers, and spaces', 422);
        }

        if ($invoiceRef !== '' && (mb_strlen($invoiceRef) > 100 || !preg_match('/^[A-Z0-9-]+$/', $invoiceRef))) {
            Response::error('Invoice reference can only contain letters, numbers, and hyphens', 422);
        }

        if (!in_array($currency, ['INR', 'USD'], true)) {
            Response::error('Currency must be INR or USD', 422);
        }

        if (!is_numeric($amountRaw)) {
            Response::error('Amount must be a valid number', 422);
        }

        $amount = round((float) $amountRaw, 2);
        if ($amount <= 0 || $amount > 99999999.99) {
            Response::error('Amount must be between 0.01 and 99999999.99', 422);
        }

        $maxAmount = $currency === 'USD'
            ? (float) Config::get('payment_max_amount_usd')
            : (float) Config::get('payment_max_amount_inr');

        if ($amount > $maxAmount) {
            Response::error('Amount exceeds allowed limit for selected currency', 422);
        }

        // Donor fields are optional for back-compat with existing SISPL flows,
        // but partner sites (e.g. positivetree.ngo) MUST send a valid donor_name
        // and donor_email so receipts can be issued and reconciled.
        if ($donorName !== '' && (mb_strlen($donorName) < 2 || mb_strlen($donorName) > 200)) {
            Response::error('Donor name must be between 2 and 200 characters', 422);
        }

        if ($donorName !== '' && !preg_match("/^[\\p{L}\\p{N} .'\\-]+$/u", $donorName)) {
            Response::error('Donor name contains unsupported characters', 422);
        }

        if ($donorEmail !== '') {
            if (mb_strlen($donorEmail) > 254 || !filter_var($donorEmail, FILTER_VALIDATE_EMAIL)) {
                Response::error('Donor email is not valid', 422);
            }
        }

        if ($donorPhone !== '') {
            $digits = preg_replace('/\D+/', '', $donorPhone) ?? '';
            if (mb_strlen($donorPhone) > 32 || strlen($digits) < 6 || strlen($digits) > 15) {
                Response::error('Donor phone must contain 6 to 15 digits', 422);
            }
        }

        if ($donorPan !== '' && !preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', $donorPan)) {
            Response::error('PAN must match the format ABCDE1234F', 422);
        }

        return [
            'client_name' => $clientName,
            'project_name' => $projectName,
            'invoice_ref' => $invoiceRef !== '' ? $invoiceRef : null,
            'currency' => $currency,
            'amount' => $amount,
            'donor_name' => $donorName !== '' ? $donorName : null,
            'donor_email' => $donorEmail !== '' ? $donorEmail : null,
            'donor_phone' => $donorPhone !== '' ? $donorPhone : null,
            'donor_pan' => $donorPan !== '' ? $donorPan : null,
        ];
    }

    public static function validateVerifyPayload(array $payload): array
    {
        $reference = trim((string) ($payload['reference'] ?? ''));
        $orderId = trim((string) ($payload['razorpay_order_id'] ?? ''));
        $paymentId = trim((string) ($payload['razorpay_payment_id'] ?? ''));
        $signature = trim((string) ($payload['razorpay_signature'] ?? ''));

        InputGuard::assertSafe($reference, 'reference');
        InputGuard::assertSafe($orderId, 'razorpay_order_id');
        InputGuard::assertSafe($paymentId, 'razorpay_payment_id');

        if ($reference === '' || !preg_match('/^PAY-[0-9]{8}-[A-Z0-9]{8}$/', $reference)) {
            Response::error('Invalid payment reference', 422);
        }

        if ($orderId === '' || !preg_match('/^order_[A-Za-z0-9]+$/', $orderId)) {
            Response::error('Invalid Razorpay order id', 422);
        }

        if ($paymentId === '' || !preg_match('/^pay_[A-Za-z0-9]+$/', $paymentId)) {
            Response::error('Invalid Razorpay payment id', 422);
        }

        if ($signature === '' || !preg_match('/^[A-Fa-f0-9]{64}$/', $signature)) {
            Response::error('Invalid payment signature', 422);
        }

        return [
            'reference' => $reference,
            'razorpay_order_id' => $orderId,
            'razorpay_payment_id' => $paymentId,
            'razorpay_signature' => $signature,
        ];
    }
}
