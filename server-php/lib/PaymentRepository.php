<?php

declare(strict_types=1);

final class PaymentRepository
{
    public function countRecentByIpHash(string $ipHash, int $hours = 1): int
    {
        $pdo = Database::connection();
        $hours = max(1, min(72, $hours));
        $interval = $hours === 1 ? '1 hour' : $hours . ' hours';
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS total
             FROM payment_records
             WHERE ip_hash = :ip_hash
               AND created_at >= NOW() - INTERVAL \'' . $interval . '\''
        );
        $stmt->bindValue(':ip_hash', $ipHash, PDO::PARAM_STR);
        $stmt->execute();

        return (int) ($stmt->fetch()['total'] ?? 0);
    }

    public function create(array $data): array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO payment_records (
                public_reference, client_name, project_name, invoice_ref, amount, currency, status,
                ip_hash, user_agent_hash, request_id, csrf_token_hash, gateway_url, metadata,
                donor_name, donor_email, donor_phone, donor_pan
             ) VALUES (
                :public_reference, :client_name, :project_name, :invoice_ref, :amount, :currency, :status,
                :ip_hash, :user_agent_hash, :request_id, :csrf_token_hash, :gateway_url, CAST(:metadata AS jsonb),
                :donor_name, :donor_email, :donor_phone, :donor_pan
             )
             RETURNING id'
        );

        $stmt->execute([
            ':public_reference' => $data['public_reference'],
            ':client_name' => $data['client_name'],
            ':project_name' => $data['project_name'],
            ':invoice_ref' => $data['invoice_ref'],
            ':amount' => $data['amount'],
            ':currency' => $data['currency'],
            ':status' => $data['status'],
            ':ip_hash' => $data['ip_hash'],
            ':user_agent_hash' => $data['user_agent_hash'],
            ':request_id' => $data['request_id'],
            ':csrf_token_hash' => $data['csrf_token_hash'],
            ':gateway_url' => $data['gateway_url'],
            ':metadata' => $data['metadata'],
            ':donor_name' => $data['donor_name'] ?? null,
            ':donor_email' => $data['donor_email'] ?? null,
            ':donor_phone' => $data['donor_phone'] ?? null,
            ':donor_pan' => $data['donor_pan'] ?? null,
        ]);

        $paymentId = (int) $stmt->fetchColumn();
        $this->writeAudit($paymentId, 'payment.created', [
            'status' => $data['status'],
            'currency' => $data['currency'],
            'amount' => $data['amount'],
        ], $data['ip_hash']);

        return $this->findById($paymentId);
    }

    public function findById(int $id): ?array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT * FROM payment_records WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    public function findByPublicReference(string $reference): ?array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'SELECT public_reference, client_name, project_name, invoice_ref, amount, currency, status,
                    razorpay_order_id, razorpay_payment_id,
                    donor_name, donor_email, donor_phone, donor_pan,
                    created_at, updated_at
             FROM payment_records
             WHERE public_reference = :public_reference
             LIMIT 1'
        );
        $stmt->execute([':public_reference' => $reference]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    public function findByRazorpayOrderId(string $orderId): ?array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT * FROM payment_records WHERE razorpay_order_id = :order_id LIMIT 1');
        $stmt->execute([':order_id' => $orderId]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    public function attachRazorpayOrder(int $paymentId, string $orderId, ?string $ipHash = null): void
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE payment_records
             SET razorpay_order_id = :order_id, status = :status
             WHERE id = :id'
        );
        $stmt->execute([
            ':order_id' => $orderId,
            ':status' => 'initiated',
            ':id' => $paymentId,
        ]);

        $this->writeAudit($paymentId, 'razorpay.order_created', ['razorpay_order_id' => $orderId], $ipHash);
    }

    public function markCompleted(int $paymentId, string $paymentIdRzp, array $payload = [], ?string $ipHash = null): ?array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE payment_records
             SET razorpay_payment_id = :payment_id, status = :status
             WHERE id = :id'
        );
        $stmt->execute([
            ':payment_id' => $paymentIdRzp,
            ':status' => 'completed',
            ':id' => $paymentId,
        ]);

        $this->writeAudit($paymentId, 'payment.completed', array_merge(['razorpay_payment_id' => $paymentIdRzp], $payload), $ipHash);

        return $this->findById($paymentId);
    }

    public function markFailed(int $paymentId, array $payload = [], ?string $ipHash = null): void
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE payment_records SET status = :status WHERE id = :id'
        );
        $stmt->execute([':status' => 'failed', ':id' => $paymentId]);
        $this->writeAudit($paymentId, 'payment.failed', $payload, $ipHash);
    }

    public function markCancelled(int $paymentId, array $payload = [], ?string $ipHash = null): void
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'UPDATE payment_records SET status = :status WHERE id = :id'
        );
        $stmt->execute([':status' => 'cancelled', ':id' => $paymentId]);
        $this->writeAudit($paymentId, 'payment.cancelled', $payload, $ipHash);
    }

    public function listForReporting(int $limit = 100, int $offset = 0): array
    {
        $limit = max(1, min($limit, 500));
        $offset = max(0, $offset);

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'SELECT public_reference, client_name, project_name, invoice_ref, amount, currency, status,
                    razorpay_order_id, razorpay_payment_id,
                    donor_name, donor_email, donor_phone, donor_pan,
                    created_at, updated_at
             FROM payment_records
             ORDER BY created_at DESC
             LIMIT :limit OFFSET :offset'
        );
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->fetchAll();
    }

    public function writeAudit(int $paymentId, string $eventType, array $payload = [], ?string $ipHash = null): void
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO payment_audit_log (payment_id, event_type, event_payload, actor, ip_hash)
             VALUES (:payment_id, :event_type, CAST(:event_payload AS jsonb), :actor, :ip_hash)'
        );
        $stmt->execute([
            ':payment_id' => $paymentId,
            ':event_type' => $eventType,
            ':event_payload' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':actor' => 'system',
            ':ip_hash' => $ipHash,
        ]);
    }

    public static function generatePublicReference(): string
    {
        return 'PAY-' . gmdate('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    }
}
