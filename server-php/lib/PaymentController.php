<?php

declare(strict_types=1);

final class PaymentController
{
    public function __construct(
        private PaymentRepository $repository = new PaymentRepository(),
        private RazorpayClient $razorpay = new RazorpayClient(),
    ) {
    }

    public function csrfToken(): void
    {
        $token = Security::issueCsrfToken();
        Response::json([
            'ok' => true,
            'csrf_token' => $token,
            'razorpay_enabled' => $this->razorpay->isConfigured(),
        ]);
    }

    public function create(): void
    {
        Security::assertSameOriginPost();
        Security::assertJsonPost();

        if (!$this->razorpay->isConfigured()) {
            Response::error('Razorpay payment gateway is not configured', 503);
        }

        $csrfHeader = trim((string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));
        if (!Security::validateCsrf($csrfHeader)) {
            Response::error('Invalid or expired CSRF token', 403);
        }

        $payload = Security::readJsonBody();
        $validated = PaymentValidator::validateCreatePayload($payload);

        $ip = Security::clientIp();
        $ipHash = Security::hashValue($ip);
        $rateLimit = (int) Config::get('payment_rate_limit_per_hour', 20);

        if ($this->repository->countRecentByIpHash($ipHash, 1) >= $rateLimit) {
            Response::error('Too many payment attempts. Please try again later.', 429);
        }

        $requestId = trim((string) ($payload['request_id'] ?? ''));
        if ($requestId === '' || !preg_match('/^[0-9a-f-]{36}$/i', $requestId)) {
            $requestId = self::uuidV4();
        }

        $publicReference = PaymentRepository::generatePublicReference();
        $amountSubunits = RazorpayClient::toSubunits($validated['amount']);

        $record = $this->repository->create([
            'public_reference' => $publicReference,
            'client_name' => $validated['client_name'],
            'project_name' => $validated['project_name'],
            'invoice_ref' => $validated['invoice_ref'],
            'amount' => $validated['amount'],
            'currency' => $validated['currency'],
            'status' => 'pending',
            'ip_hash' => $ipHash,
            'user_agent_hash' => Security::hashValue(substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 512)),
            'request_id' => $requestId,
            'csrf_token_hash' => Security::hashValue($csrfHeader),
            'gateway_url' => 'razorpay',
            'metadata' => json_encode([
                'source' => 'web_modal',
                'origin' => $_SERVER['HTTP_ORIGIN'] ?? null,
                'gateway' => 'razorpay',
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'donor_name' => $validated['donor_name'] ?? null,
            'donor_email' => $validated['donor_email'] ?? null,
            'donor_phone' => $validated['donor_phone'] ?? null,
            'donor_pan' => $validated['donor_pan'] ?? null,
        ]);

        $receipt = substr($publicReference, 0, 40);
        $orderNotes = [
            'public_reference' => $publicReference,
            'client_name' => $validated['client_name'],
            'project_name' => $validated['project_name'],
            'invoice_ref' => $validated['invoice_ref'] ?? '',
        ];
        if (!empty($validated['donor_name'])) {
            $orderNotes['donor_name'] = $validated['donor_name'];
        }
        if (!empty($validated['donor_email'])) {
            $orderNotes['donor_email'] = $validated['donor_email'];
        }
        if (!empty($validated['donor_pan'])) {
            $orderNotes['donor_pan'] = $validated['donor_pan'];
        }

        $order = $this->razorpay->createOrder(
            $amountSubunits,
            $validated['currency'],
            $receipt,
            $orderNotes
        );

        $orderId = (string) ($order['id'] ?? '');
        if ($orderId === '') {
            Response::error('Unable to create Razorpay order', 502);
        }

        $this->repository->attachRazorpayOrder((int) $record['id'], $orderId, $ipHash);

        $description = $validated['project_name'];
        if ($validated['invoice_ref']) {
            $description .= ' · Invoice ' . $validated['invoice_ref'];
        }

        $prefill = [
            // Prefer the actual donor's name on the Razorpay checkout when present;
            // fall back to the client/organisation name for legacy SISPL invoices.
            'name' => $validated['donor_name'] ?? $validated['client_name'],
        ];
        if (!empty($validated['donor_email'])) {
            $prefill['email'] = $validated['donor_email'];
        }
        if (!empty($validated['donor_phone'])) {
            $prefill['contact'] = $validated['donor_phone'];
        }

        $checkoutNotes = [
            'public_reference' => $publicReference,
            'client_name' => $validated['client_name'],
            'project_name' => $validated['project_name'],
        ];
        if (!empty($validated['donor_name'])) {
            $checkoutNotes['donor_name'] = $validated['donor_name'];
        }
        if (!empty($validated['donor_email'])) {
            $checkoutNotes['donor_email'] = $validated['donor_email'];
        }
        if (!empty($validated['donor_pan'])) {
            $checkoutNotes['donor_pan'] = $validated['donor_pan'];
        }

        Response::json([
            'ok' => true,
            'payment' => [
                'reference' => $publicReference,
                'client_name' => $validated['client_name'],
                'project_name' => $validated['project_name'],
                'invoice_ref' => $validated['invoice_ref'],
                'amount' => $validated['amount'],
                'currency' => $validated['currency'],
                'status' => 'initiated',
                'created_at' => $record['created_at'],
                'donor_name' => $validated['donor_name'] ?? null,
                'donor_email' => $validated['donor_email'] ?? null,
                'donor_phone' => $validated['donor_phone'] ?? null,
                'donor_pan' => $validated['donor_pan'] ?? null,
            ],
            'razorpay' => [
                'key_id' => $this->razorpay->keyId(),
                'order_id' => $orderId,
                'amount' => $amountSubunits,
                'currency' => $validated['currency'],
                'name' => (string) Config::get('razorpay_company_name', 'SISPL'),
                'description' => $description,
                'prefill' => $prefill,
                'notes' => $checkoutNotes,
            ],
        ], 201);
    }

    public function verify(): void
    {
        Security::assertSameOriginPost();
        Security::assertJsonPost();

        $csrfHeader = trim((string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));
        if (!Security::validateCsrf($csrfHeader)) {
            Response::error('Invalid or expired CSRF token', 403);
        }

        $payload = Security::readJsonBody();
        $validated = PaymentValidator::validateVerifyPayload($payload);
        $reference = $validated['reference'];
        $orderId = $validated['razorpay_order_id'];
        $paymentId = $validated['razorpay_payment_id'];
        $signature = $validated['razorpay_signature'];

        $record = $this->repository->findByPublicReference($reference);
        if ($record === null) {
            Response::error('Payment record not found', 404);
        }

        if (!empty($record['razorpay_order_id']) && $record['razorpay_order_id'] !== $orderId) {
            Response::error('Order mismatch for payment reference', 409);
        }

        if ($record['status'] === 'completed') {
            Response::json(['ok' => true, 'payment' => $record, 'message' => 'Already verified']);
        }

        if (!$this->razorpay->verifyPaymentSignature($orderId, $paymentId, $signature)) {
            $fullRecord = $this->repository->findByRazorpayOrderId($orderId);
            if ($fullRecord !== null) {
                $this->repository->markFailed((int) $fullRecord['id'], [
                    'reason' => 'signature_mismatch',
                ], Security::hashValue(Security::clientIp()));
            }
            Response::error('Payment verification failed', 400);
        }

        $fullRecord = $this->repository->findByRazorpayOrderId($orderId);
        if ($fullRecord === null) {
            Response::error('Payment record not found for order', 404);
        }

        $updated = $this->repository->markCompleted(
            (int) $fullRecord['id'],
            $paymentId,
            ['verified_via' => 'checkout_callback'],
            Security::hashValue(Security::clientIp())
        );

        Response::json([
            'ok' => true,
            'payment' => [
                'reference' => $updated['public_reference'],
                'client_name' => $updated['client_name'],
                'project_name' => $updated['project_name'],
                'invoice_ref' => $updated['invoice_ref'],
                'amount' => (float) $updated['amount'],
                'currency' => $updated['currency'],
                'status' => $updated['status'],
                'razorpay_order_id' => $updated['razorpay_order_id'],
                'razorpay_payment_id' => $updated['razorpay_payment_id'],
                'donor_name' => $updated['donor_name'] ?? null,
                'donor_email' => $updated['donor_email'] ?? null,
                'donor_phone' => $updated['donor_phone'] ?? null,
                'donor_pan' => $updated['donor_pan'] ?? null,
                'updated_at' => $updated['updated_at'],
            ],
        ]);
    }

    public function razorpayWebhook(): void
    {
        $payload = file_get_contents('php://input') ?: '';
        $signature = trim((string) ($_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? ''));

        if (!$this->razorpay->verifyWebhookSignature($payload, $signature)) {
            Response::error('Invalid webhook signature', 400);
        }

        $event = json_decode($payload, true);
        if (!is_array($event)) {
            Response::error('Invalid webhook payload', 400);
        }

        $eventType = (string) ($event['event'] ?? '');
        $entity = $event['payload']['payment']['entity'] ?? null;

        if (!is_array($entity)) {
            Response::json(['ok' => true, 'ignored' => true]);
        }

        $orderId = (string) ($entity['order_id'] ?? '');
        $paymentId = (string) ($entity['id'] ?? '');
        $record = $orderId !== '' ? $this->repository->findByRazorpayOrderId($orderId) : null;

        if ($record === null) {
            Response::json(['ok' => true, 'ignored' => true]);
        }

        $paymentDbId = (int) $record['id'];

        if ($eventType === 'payment.captured' && $record['status'] !== 'completed') {
            $this->repository->markCompleted($paymentDbId, $paymentId, [
                'verified_via' => 'webhook',
                'event' => $eventType,
            ]);
        }

        if (in_array($eventType, ['payment.failed', 'payment.authorized'], true) && $eventType === 'payment.failed') {
            $this->repository->markFailed($paymentDbId, ['event' => $eventType]);
        }

        $this->repository->writeAudit($paymentDbId, 'razorpay.webhook', [
            'event' => $eventType,
            'payment_id' => $paymentId,
        ]);

        Response::json(['ok' => true]);
    }

    public function status(string $reference): void
    {
        $record = $this->repository->findByPublicReference($reference);
        if ($record === null) {
            Response::error('Payment record not found', 404);
        }

        if (isset($_GET['sync']) && $_GET['sync'] === '1') {
            $record = $this->syncPaymentFromRazorpay($record);
        }

        Response::json([
            'ok' => true,
            'payment' => $this->formatPaymentRecord($record),
        ]);
    }

    /**
     * Checkout config for partner sites. Razorpay must open on sispl.org only;
     * partner sites redirect donors here after creating a payment via POST /payments.
     */
    public function checkout(string $reference): void
    {
        if (!$this->razorpay->isConfigured()) {
            Response::error('Razorpay payment gateway is not configured', 503);
        }

        $returnTo = trim((string) ($_GET['return_to'] ?? ''));
        if ($returnTo === '') {
            Response::error('return_to is required', 400);
        }

        if (!$this->isAllowedPartnerUrl($returnTo)) {
            Response::error('Return URL is not allowed', 403);
        }

        $record = $this->repository->findByPublicReference($reference);
        if ($record === null) {
            Response::error('Payment record not found', 404);
        }

        if (($record['status'] ?? '') === 'completed') {
            Response::json([
                'ok' => true,
                'already_completed' => true,
                'payment' => $this->formatPaymentRecord($record),
                'return_to' => $returnTo,
            ]);
        }

        $orderId = (string) ($record['razorpay_order_id'] ?? '');
        if ($orderId === '') {
            Response::error('Payment is not ready for checkout', 409);
        }

        Response::json([
            'ok' => true,
            'payment' => $this->formatPaymentRecord($record),
            'return_to' => $returnTo,
            'razorpay' => $this->buildRazorpayCheckoutFromRecord($record, $returnTo),
        ]);
    }

    /**
     * Razorpay callback_url target for cross-origin partner checkouts.
     * Razorpay POSTs payment ids here; we verify/sync then redirect the donor
     * back to the partner site (return_to) with payment_complete=1.
     */
    public function returnCallback(): void
    {
        $reference = trim((string) ($_GET['ref'] ?? $_GET['donation_ref'] ?? ''));
        $returnTo = trim((string) ($_GET['return_to'] ?? ''));

        if ($reference === '' || $returnTo === '') {
            Response::error('Invalid payment return callback', 400);
        }

        if (!$this->isAllowedPartnerUrl($returnTo)) {
            Response::error('Return URL is not allowed', 403);
        }

        $record = $this->repository->findByPublicReference($reference);
        if ($record === null) {
            Response::error('Payment record not found', 404);
        }

        $paymentId = trim((string) ($_POST['razorpay_payment_id'] ?? $_GET['razorpay_payment_id'] ?? ''));
        $orderId = trim((string) ($_POST['razorpay_order_id'] ?? $_GET['razorpay_order_id'] ?? ''));
        $signature = trim((string) ($_POST['razorpay_signature'] ?? $_GET['razorpay_signature'] ?? ''));

        if (($record['status'] ?? '') !== 'completed') {
            if ($paymentId !== '' && $orderId !== '' && $signature !== '') {
                if (!empty($record['razorpay_order_id']) && $record['razorpay_order_id'] !== $orderId) {
                    Response::error('Order mismatch for payment reference', 409);
                }

                if ($this->razorpay->verifyPaymentSignature($orderId, $paymentId, $signature)) {
                    $fullRecord = $this->repository->findByRazorpayOrderId($orderId);
                    if ($fullRecord !== null) {
                        $record = $this->repository->markCompleted(
                            (int) $fullRecord['id'],
                            $paymentId,
                            ['verified_via' => 'return_callback'],
                            Security::hashValue(Security::clientIp())
                        ) ?? $record;
                    }
                }
            }

            if (($record['status'] ?? '') !== 'completed') {
                $record = $this->syncPaymentFromRazorpay($record);
            }
        }

        $redirectUrl = $this->buildPartnerReturnUrl(
            $returnTo,
            $reference,
            (string) ($record['razorpay_payment_id'] ?? $paymentId),
            (string) ($record['razorpay_order_id'] ?? $orderId),
            $signature,
            ($record['status'] ?? '') === 'completed'
        );

        header('Location: ' . $redirectUrl, true, 302);
        exit;
    }

    private function syncPaymentFromRazorpay(array $record): array
    {
        if (($record['status'] ?? '') === 'completed') {
            return $record;
        }

        $orderId = (string) ($record['razorpay_order_id'] ?? '');
        if ($orderId === '' || !$this->razorpay->isConfigured()) {
            return $record;
        }

        $fullRecord = $this->repository->findByRazorpayOrderId($orderId);
        if ($fullRecord === null) {
            return $record;
        }

        if (($fullRecord['status'] ?? '') === 'completed') {
            return $this->repository->findByPublicReference($record['public_reference']) ?? $fullRecord;
        }

        $paymentsResponse = $this->razorpay->fetchOrderPayments($orderId);
        $completed = $this->completeFromRazorpayPayments($fullRecord, $paymentsResponse['items'] ?? []);
        if ($completed !== null) {
            return $completed;
        }

        $order = $this->razorpay->fetchOrder($orderId);
        if (is_array($order) && (string) ($order['status'] ?? '') === 'paid') {
            $retryPayments = $this->razorpay->fetchOrderPayments($orderId);
            $completed = $this->completeFromRazorpayPayments($fullRecord, $retryPayments['items'] ?? []);
            if ($completed !== null) {
                return $completed;
            }
        }

        return $record;
    }

    /** @param list<array<string, mixed>> $payments */
    private function completeFromRazorpayPayments(array $fullRecord, array $payments): ?array
    {
        foreach ($payments as $payment) {
            $paymentStatus = (string) ($payment['status'] ?? '');
            if (!in_array($paymentStatus, ['captured', 'authorized'], true)) {
                continue;
            }

            $paymentId = (string) ($payment['id'] ?? '');
            if ($paymentId === '') {
                continue;
            }

            $this->repository->markCompleted(
                (int) $fullRecord['id'],
                $paymentId,
                ['verified_via' => 'status_sync', 'razorpay_status' => $paymentStatus],
                Security::hashValue(Security::clientIp())
            );

            return $this->repository->findByPublicReference($fullRecord['public_reference']) ?? $fullRecord;
        }

        return null;
    }

    private function formatPaymentRecord(array $record): array
    {
        return [
            'reference' => $record['public_reference'],
            'public_reference' => $record['public_reference'],
            'client_name' => $record['client_name'],
            'project_name' => $record['project_name'],
            'invoice_ref' => $record['invoice_ref'] ?? null,
            'amount' => (float) $record['amount'],
            'currency' => $record['currency'],
            'status' => $record['status'],
            'razorpay_order_id' => $record['razorpay_order_id'] ?? null,
            'razorpay_payment_id' => $record['razorpay_payment_id'] ?? null,
            'donor_name' => $record['donor_name'] ?? null,
            'donor_email' => $record['donor_email'] ?? null,
            'donor_phone' => $record['donor_phone'] ?? null,
            'donor_pan' => $record['donor_pan'] ?? null,
            'created_at' => $record['created_at'] ?? null,
            'updated_at' => $record['updated_at'] ?? null,
        ];
    }

    private function isAllowedPartnerUrl(string $url): bool
    {
        $parsed = parse_url($url);
        if (!is_array($parsed) || empty($parsed['scheme']) || empty($parsed['host'])) {
            return false;
        }

        if (!in_array(strtolower((string) $parsed['scheme']), ['http', 'https'], true)) {
            return false;
        }

        $origin = strtolower((string) $parsed['scheme']) . '://' . strtolower((string) $parsed['host']);
        if (!empty($parsed['port'])) {
            $origin .= ':' . $parsed['port'];
        }

        $allowed = Config::get('cors_origins', []);
        foreach ($allowed as $allowedOrigin) {
            if (strcasecmp((string) $allowedOrigin, $origin) === 0) {
                return true;
            }
        }

        return false;
    }

    /** @param array<string, mixed> $record */
    private function buildRazorpayCheckoutFromRecord(array $record, string $returnTo): array
    {
        $orderId = (string) ($record['razorpay_order_id'] ?? '');
        $amountSubunits = RazorpayClient::toSubunits((float) $record['amount']);
        $description = (string) $record['project_name'];
        if (!empty($record['invoice_ref'])) {
            $description .= ' · Invoice ' . $record['invoice_ref'];
        }

        $prefill = [
            'name' => $record['donor_name'] ?? $record['client_name'],
        ];
        if (!empty($record['donor_email'])) {
            $prefill['email'] = $record['donor_email'];
        }
        if (!empty($record['donor_phone'])) {
            $prefill['contact'] = $record['donor_phone'];
        }

        $checkoutNotes = [
            'public_reference' => $record['public_reference'],
            'client_name' => $record['client_name'],
            'project_name' => $record['project_name'],
        ];
        if (!empty($record['donor_name'])) {
            $checkoutNotes['donor_name'] = $record['donor_name'];
        }
        if (!empty($record['donor_email'])) {
            $checkoutNotes['donor_email'] = $record['donor_email'];
        }
        if (!empty($record['donor_pan'])) {
            $checkoutNotes['donor_pan'] = $record['donor_pan'];
        }

        return [
            'key_id' => $this->razorpay->keyId(),
            'order_id' => $orderId,
            'amount' => $amountSubunits,
            'currency' => $record['currency'],
            'name' => (string) $record['client_name'],
            'description' => $description,
            'prefill' => $prefill,
            'notes' => $checkoutNotes,
            'callback_url' => $this->buildReturnCallbackUrl($record['public_reference'], $returnTo),
        ];
    }

    private function buildReturnCallbackUrl(string $reference, string $returnTo): string
    {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'sispl.org');
        $base = $scheme . '://' . $host . '/api/payments/return';

        return $base . '?' . http_build_query([
            'ref' => $reference,
            'return_to' => $returnTo,
        ]);
    }

    private function buildPartnerReturnUrl(
        string $returnTo,
        string $reference,
        string $paymentId,
        string $orderId,
        string $signature,
        bool $completed,
    ): string {
        $query = [
            'donation_ref' => $reference,
            'payment_complete' => $completed ? '1' : '0',
        ];

        if ($paymentId !== '') {
            $query['razorpay_payment_id'] = $paymentId;
        }
        if ($orderId !== '') {
            $query['razorpay_order_id'] = $orderId;
        }
        if ($signature !== '') {
            $query['razorpay_signature'] = $signature;
        }

        $fragment = '';
        $base = $returnTo;
        if (str_contains($returnTo, '#')) {
            [$base, $fragment] = explode('#', $returnTo, 2);
        }

        $separator = str_contains($base, '?') ? '&' : '?';

        return $base . $separator . http_build_query($query) . ($fragment !== '' ? '#' . $fragment : '');
    }

    public function report(): void
    {
        $adminKey = trim((string) ($_SERVER['HTTP_X_ADMIN_KEY'] ?? ''));
        $expected = (string) Config::get('payment_admin_api_key', '');

        if ($expected === '' || $adminKey === '' || !hash_equals($expected, $adminKey)) {
            Response::error('Unauthorized', 401);
        }

        $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 100;
        $offset = isset($_GET['offset']) ? (int) $_GET['offset'] : 0;

        Response::json([
            'ok' => true,
            'payments' => $this->repository->listForReporting($limit, $offset),
        ]);
    }

    private static function uuidV4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
