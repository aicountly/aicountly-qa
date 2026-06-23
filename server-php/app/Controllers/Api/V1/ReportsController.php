<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\ReportsModel;
use Config\Services;

class ReportsController extends BaseApiController
{
    public function index()
    {
        $q = $this->request->getGet();
        $m = new ReportsModel();
        if (! empty($q['qa_run_id']))  { $m->where('qa_run_id', $q['qa_run_id']); }
        if (! empty($q['kind']))       { $m->where('kind', $q['kind']); }
        if (! empty($q['product']))    { $m->where('product_name', $q['product']); }
        return $this->ok($m->orderBy('generated_at', 'DESC')->limit(200)->findAll());
    }

    public function show(string $qaRunId)
    {
        $rows = (new ReportsModel())->where('qa_run_id', $qaRunId)->orderBy('generated_at', 'DESC')->findAll();
        return $this->ok($rows);
    }

    public function html(string $qaRunId)
    {
        return $this->serve($qaRunId, 'html');
    }

    public function json(string $qaRunId)
    {
        return $this->serve($qaRunId, 'json');
    }

    public function sessionHtml(int $sessionId)
    {
        return $this->serveSession($sessionId, 'html');
    }

    public function sessionJson(int $sessionId)
    {
        return $this->serveSession($sessionId, 'json');
    }

    private function serveSession(int $sessionId, string $kind)
    {
        $row = (new ReportsModel())->where('session_id', $sessionId)->where('kind', 'session')
            ->orderBy('generated_at', 'DESC')->first();
        if (! $row) {
            return $this->fail('Session report not yet generated.', 404);
        }
        Services::auditService()->log('report_viewed', [
            'qa_run_id'    => $row['qa_run_id'] ?? null,
            'session_id'   => $sessionId,
            'subject_kind' => 'report',
            'subject_id'   => $row['id'],
            'metadata'     => ['kind' => $kind, 'scope' => 'session'],
        ]);
        $path = $kind === 'html' ? ($row['html_path'] ?? '') : ($row['json_path'] ?? '');
        if ($path === '' || ! is_file($path)) {
            return $this->fail('Report file missing on disk.', 410);
        }
        $mime = $kind === 'html' ? 'text/html' : 'application/json';

        return $this->response->setHeader('Content-Type', $mime)->setBody((string) file_get_contents($path));
    }

    private function serve(string $qaRunId, string $kind)
    {
        $row = (new ReportsModel())->where('qa_run_id', $qaRunId)->where('kind', 'final')
            ->orderBy('generated_at', 'DESC')->first();
        if (! $row) {
            return $this->fail('Final report not yet generated for this run.', 404);
        }
        Services::auditService()->log('report_viewed', [
            'qa_run_id'    => $qaRunId,
            'subject_kind' => 'report',
            'subject_id'   => $row['id'],
            'metadata'     => ['kind' => $kind],
        ]);
        $path = $kind === 'html' ? $row['html_path'] : $row['json_path'];
        if (! is_file($path)) {
            return $this->fail('Report file missing on disk.', 410);
        }
        $mime = $kind === 'html' ? 'text/html' : 'application/json';
        return $this->response->setHeader('Content-Type', $mime)->setBody((string) file_get_contents($path));
    }
}
