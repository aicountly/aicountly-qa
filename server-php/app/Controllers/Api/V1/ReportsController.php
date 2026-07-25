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

        $path = $row ? (($kind === 'html' ? ($row['html_path'] ?? '') : ($row['json_path'] ?? ''))) : '';

        if ($path === '' || ! is_file($path)) {
            $built = Services::reportService()->buildSessionReport($sessionId);
            if (! ($built['ok'] ?? false)) {
                return $this->fail($built['error'] ?? 'Session report not yet generated.', 404);
            }

            $path = $kind === 'html' ? (string) ($built['html'] ?? '') : (string) ($built['json'] ?? '');
            if ($path === '' || ! is_file($path)) {
                $body = $kind === 'html' ? ($built['html_body'] ?? null) : ($built['json_body'] ?? null);
                if (is_string($body) && $body !== '') {
                    $this->auditReportView($built['id'] ?? null, $built['qa_run_id'] ?? ($row['qa_run_id'] ?? null), $sessionId, $kind, 'session');

                    return $this->streamReport($kind, $body);
                }

                return $this->fail('Report file missing on disk and could not be written. Check QA_REPORTS_DIR permissions.', 410);
            }

            $row = (new ReportsModel())->where('session_id', $sessionId)->where('kind', 'session')
                ->orderBy('generated_at', 'DESC')->first();
        }

        $this->auditReportView($row['id'] ?? null, $row['qa_run_id'] ?? null, $sessionId, $kind, 'session');

        return $this->streamReport($kind, (string) file_get_contents($path));
    }

    private function serve(string $qaRunId, string $kind)
    {
        $row = (new ReportsModel())->where('qa_run_id', $qaRunId)->where('kind', 'final')
            ->orderBy('generated_at', 'DESC')->first();

        $path = $row ? (($kind === 'html' ? ($row['html_path'] ?? '') : ($row['json_path'] ?? ''))) : '';

        if ($path === '' || ! is_file($path)) {
            $built = Services::reportService()->materializeFinalReport($qaRunId);
            if (! ($built['ok'] ?? false)) {
                return $this->fail($built['error'] ?? 'Final report not yet generated for this run.', 404);
            }

            $path = $kind === 'html' ? (string) ($built['html'] ?? '') : (string) ($built['json'] ?? '');
            if ($path === '' || ! is_file($path)) {
                $body = $kind === 'html' ? ($built['html_body'] ?? null) : ($built['json_body'] ?? null);
                if (is_string($body) && $body !== '') {
                    $this->auditReportView($built['id'] ?? null, $qaRunId, null, $kind, 'final');

                    return $this->streamReport($kind, $body);
                }

                return $this->fail('Report file missing on disk and could not be written. Check QA_REPORTS_DIR permissions.', 410);
            }

            $row = (new ReportsModel())->where('qa_run_id', $qaRunId)->where('kind', 'final')
                ->orderBy('generated_at', 'DESC')->first();
        }

        $this->auditReportView($row['id'] ?? null, $qaRunId, null, $kind, 'final');

        return $this->streamReport($kind, (string) file_get_contents($path));
    }

    private function streamReport(string $kind, string $body)
    {
        $mime = $kind === 'html' ? 'text/html; charset=UTF-8' : 'application/json; charset=UTF-8';

        return $this->response->setHeader('Content-Type', $mime)->setBody($body);
    }

    private function auditReportView(mixed $reportId, mixed $qaRunId, ?int $sessionId, string $kind, string $scope): void
    {
        Services::auditService()->log('report_viewed', [
            'qa_run_id'    => $qaRunId,
            'session_id'   => $sessionId,
            'subject_kind' => 'report',
            'subject_id'   => $reportId,
            'metadata'     => ['kind' => $kind, 'scope' => $scope],
        ]);
    }
}
