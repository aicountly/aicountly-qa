<?php

namespace Tests\Database;

use App\Models\AuditLogsModel;
use App\Services\AuditService;
use App\Services\JsonColumnRepairService;
use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;

/**
 * JSON columns through the models: an audit row without metadata (SQL NULL) reads as null — the
 * non-nullable cast threw on it, so listing the audit log failed — metadata is stored once, a row an
 * older release stored double-encoded still reads, and qa:repair-json rewrites it.
 *
 * @internal
 */
final class JsonColumnsTest extends CIUnitTestCase
{
    use DatabaseTestTrait;

    protected $migrate     = true;
    protected $migrateOnce = true;
    protected $refresh     = false;
    protected $namespace   = 'App';

    protected function setUp(): void
    {
        $config = config('Database')->tests;
        if (trim((string) ($config['database'] ?? '')) === '') {
            $this->markTestSkipped('Set database.tests.* to a scratch PostgreSQL database to run the database suite.');
        }
        parent::setUp();
        $this->db->query("DELETE FROM qa_audit_logs WHERE event LIKE 'zz.%'");
    }

    private function jsonType(int $id): ?string
    {
        return $this->db->query('SELECT jsonb_typeof(metadata) AS t FROM qa_audit_logs WHERE id = ?', [$id])->getRow()->t ?? null;
    }

    public function testAuditMetadataNullStoredAndLegacy(): void
    {
        $m = new AuditLogsModel();
        (new AuditService())->log('zz.no_metadata');
        $row = $m->where('event', 'zz.no_metadata')->first();
        $this->assertNotNull($row);
        $this->assertNull($row['metadata'], 'SQL NULL reads as null');

        (new AuditService())->log('zz.with_metadata', ['metadata' => ['run' => 7]]);
        $row = $m->where('event', 'zz.with_metadata')->first();
        $this->assertSame('object', $this->jsonType((int) $row['id']));
        $this->assertSame(['run' => 7], $row['metadata']);

        $this->db->query("INSERT INTO qa_audit_logs (event, metadata, created_at) VALUES ('zz.legacy', to_jsonb(?::text), NOW())", ['{"run":8}']);
        $legacy = $m->where('event', 'zz.legacy')->first();
        $this->assertSame(['run' => 8], $legacy['metadata'], 'a double-encoded row still reads');
        $this->assertNotSame([], $m->findAll(), 'the audit list loads');

        $repair = new JsonColumnRepairService($this->db);
        $this->assertSame(1, array_sum(array_column($repair->run(true, 'qa_audit_logs'), 'repaired')));
        $this->assertSame('object', $this->jsonType((int) $legacy['id']));
        $this->assertSame(0, array_sum(array_column($repair->run(false), 'candidates')));
    }
}
