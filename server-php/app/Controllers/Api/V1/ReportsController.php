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

        return $this->ok($this->withUrls($m->orderBy('generated_at', 'DESC')->limit(200)->findAll()));
    }

    public function show(string $qaRunId)
    {
        $rows = (new ReportsModel())->where('qa_run_id', $qaRunId)->orderBy('generated_at', 'DESC')->findAll();

        return $this->ok($this->withUrls($rows));
    }

    /**
     * Session-kind rows must address the session endpoints, not the run-level ones,
     * otherwise every session in a run opens the same consolidated report.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function withUrls(array $rows): array
    {
        return array_map(static function (array $row): array {
            $isSession = (string) ($row['kind'] ?? '') === 'session' && ! empty($row['session_id']);
            $base = $isSession
                ? 'api/v1/reports/session/' . (int) $row['session_id']
                : 'api/v1/reports/' . rawurlencode((string) ($row['qa_run_id'] ?? ''));

            $row['html_url']    = $base . '/html';
            $row['json_url']    = $base . '/json';
            $row['prompts_url'] = $base . '/prompts';

            return $row;
        }, $rows);
    }

    /**
     * Consolidated developer prompt pack for a run.
     * Default response is JSON: {ok:true,data:{qa_run_id,kind,markdown}}.
     * Add ?format=md (or Accept: text/markdown) for the raw markdown body.
     */
    public function prompts(string $qaRunId)
    {
        $built = Services::reportService()->materializeFinalReport($qaRunId);
        if (! ($built['ok'] ?? false)) {
            return $this->fail($built['error'] ?? 'Final report not yet generated for this run.', 404);
        }

        $markdown = (string) ($built['prompts_body'] ?? '');
        $this->auditReportView($built['id'] ?? null, $qaRunId, null, 'prompts', 'final');

        return $this->respondPrompts($markdown, [
            'qa_run_id' => $qaRunId,
            'kind'      => 'final',
            'filename'  => basename((string) ($built['prompts'] ?? 'consolidated.cursor-prompts.md')),
        ]);
    }

    /** Per-session developer prompt pack; same response shape as prompts(). */
    public function sessionPrompts(int $sessionId)
    {
        $built = Services::reportService()->buildSessionReport($sessionId);
        if (! ($built['ok'] ?? false)) {
            return $this->fail($built['error'] ?? 'Session report not yet generated.', 404);
        }

        $markdown = (string) ($built['prompts_body'] ?? '');
        $this->auditReportView($built['id'] ?? null, $built['qa_run_id'] ?? null, $sessionId, 'prompts', 'session');

        return $this->respondPrompts($markdown, [
            'qa_run_id'  => $built['qa_run_id'] ?? null,
            'session_id' => $sessionId,
            'kind'       => 'session',
            'filename'   => basename((string) ($built['prompts'] ?? 'report.cursor-prompts.md')),
        ]);
    }

    /** @param array<string, mixed> $meta */
    private function respondPrompts(string $markdown, array $meta)
    {
        $format = strtolower(trim((string) ($this->request->getGet('format') ?? '')));
        $wantsRaw = $format === 'md' || $format === 'markdown'
            || str_contains(strtolower($this->request->getHeaderLine('Accept')), 'text/markdown');

        if ($wantsRaw) {
            return $this->response
                ->setHeader('Content-Type', 'text/markdown; charset=UTF-8')
                ->setBody($markdown);
        }

        return $this->ok($meta + ['markdown' => $markdown]);
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
