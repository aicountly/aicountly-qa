<?php

namespace App\Services;

use App\Models\FileIoTestsModel;
use App\Models\RunDecisionsModel;
use App\Models\ReportsModel;
use App\Models\RunsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\ValidationResultsModel;
use Config\Environments;

/**
 * Assembles session and final consolidated reports (HTML + JSON) and writes them
 * under {reports_root}/{product}/{YYYY-MM-DD}/{qa_run_id}/.
 *
 * Worker uploads raw evidence (screenshots, trace.zip, console, network) directly
 * under the same folder; this service stitches them together into navigable HTML.
 */
class ReportService
{
    public function buildSessionReport(int $sessionId): array
    {
        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return ['ok' => false, 'error' => 'session not found'];
        }

        $result = (new SessionResultsModel())->where('session_id', $sessionId)->first();
        $validations = (new ValidationResultsModel())->where('session_id', $sessionId)->findAll();
        $decisions = (new RunDecisionsModel())->where('session_id', $sessionId)->orderBy('created_at')->findAll();
        $run = (new RunsModel())->find($session['qa_run_id']);
        $fileIo = (new FileIoTestsModel())->forSession($sessionId);

        $resultJson  = is_array($result['result_json'] ?? null) ? $result['result_json'] : [];
        $failedSteps = array_values(array_filter(
            (array) ($resultJson['failed_steps'] ?? []),
            static fn ($step): bool => is_array($step)
        ));

        $json = [
            'qa_run_id'        => $session['qa_run_id'],
            'kind'             => 'session',
            'session'          => $session,
            'run'              => $run,
            'environment'      => [
                'value'         => Environments::normalize((string) ($run['environment'] ?? '')),
                'label'         => Environments::label((string) ($run['environment'] ?? '')),
                'observer_only' => Environments::isObserverOnly((string) ($run['environment'] ?? '')),
            ],
            'result'           => $result,
            'failed_steps'     => $failedSteps,
            'validations'      => $validations,
            'decisions_taken'  => $decisions,
            'file_io_tests'    => $fileIo,
            'file_io_summary'  => FileIoTestsModel::summarise($fileIo),
            'evidence'         => $this->collectEvidence($result),
            'generated_at'     => gmdate('c'),
        ];
        $json['human_summary'] = $this->sessionHumanSummary($json);

        $markdown = (new CursorPromptBuilder())->forSession($json);
        $json['developer_prompt_pack'] = $markdown;

        $jsonBody = json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $htmlBody = $this->renderSessionHtml($json);

        $dir = $this->sessionDir($session, $run);
        $jsonPath = $dir . '/report.json';
        $htmlPath = $dir . '/report.html';
        $mdPath   = $dir . '/report.cursor-prompts.md';
        $written  = $this->writeReportFiles($dir, $jsonPath, $jsonBody, $htmlPath, $htmlBody);
        if ($written) {
            @file_put_contents($mdPath, $markdown);
        }

        $reportId = $this->upsertReportRow([
            'qa_run_id'    => $session['qa_run_id'],
            'session_id'   => $sessionId,
            'kind'         => 'session',
            'product_name' => $run['product_name'] ?? 'unknown',
            'html_path'    => $htmlPath,
            'json_path'    => $jsonPath,
            'generated_at' => date('Y-m-d H:i:s'),
        ], 'session', $sessionId);

        return [
            'ok'            => true,
            'id'            => $reportId,
            'qa_run_id'     => $session['qa_run_id'],
            'html'          => $htmlPath,
            'json'          => $jsonPath,
            'prompts'       => $mdPath,
            'written'       => $written,
            'html_body'     => $htmlBody,
            'json_body'     => $jsonBody,
            'prompts_body'  => $markdown,
            'human_summary' => $json['human_summary'],
        ];
    }

    public function buildFinalReport(string $qaRunId): array
    {
        $payload = $this->buildFinalPayload($qaRunId);
        if (! ($payload['ok'] ?? false)) {
            return $payload;
        }

        $json        = $payload['json'];
        $totals      = $payload['totals'];
        $run         = $payload['run'];
        $markdown    = (new CursorPromptBuilder())->forRun($json);
        $json['developer_prompt_pack'] = $markdown;
        $jsonBody    = json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $htmlBody    = $this->renderFinalHtml($json);

        $dir      = $this->runDir($run);
        $jsonPath = $dir . '/consolidated.json';
        $htmlPath = $dir . '/consolidated.html';
        $mdPath   = $dir . '/consolidated.cursor-prompts.md';
        $written  = $this->writeReportFiles($dir, $jsonPath, $jsonBody, $htmlPath, $htmlBody);
        if ($written) {
            @file_put_contents($mdPath, $markdown);
        }

        (new RunsModel())->update($qaRunId, [
            'status'       => $totals['failed'] > 0 ? 'failed' : 'completed',
            'completed_at' => ! empty($run['completed_at']) ? $run['completed_at'] : date('Y-m-d H:i:s'),
            'summary_json' => $totals,
        ]);

        $reportId = $this->upsertReportRow([
            'qa_run_id'    => $qaRunId,
            'session_id'   => null,
            'kind'         => 'final',
            'product_name' => $run['product_name'] ?? 'unknown',
            'html_path'    => $htmlPath,
            'json_path'    => $jsonPath,
            'generated_at' => date('Y-m-d H:i:s'),
        ], 'final', null, $qaRunId);

        return [
            'ok'           => true,
            'id'           => $reportId,
            'html'         => $htmlPath,
            'json'         => $jsonPath,
            'prompts'      => $mdPath,
            'totals'       => $totals,
            'written'      => $written,
            'html_body'    => $htmlBody,
            'json_body'    => $jsonBody,
            'prompts_body' => $markdown,
        ];
    }

    /**
     * Build final report content without requiring disk (used when files are missing).
     *
     * @return array{ok: bool, error?: string, html_body?: string, json_body?: string, html?: string, json?: string}
     */
    public function materializeFinalReport(string $qaRunId): array
    {
        return $this->buildFinalReport($qaRunId);
    }

    /**
     * @return array{ok: bool, error?: string, json?: array, totals?: array, run?: array}
     */
    private function buildFinalPayload(string $qaRunId): array
    {
        $run = (new RunsModel())->find($qaRunId);
        if (! $run) {
            return ['ok' => false, 'error' => 'run not found'];
        }

        $sessions    = (new SessionsModel())->where('qa_run_id', $qaRunId)->orderBy('order_index')->findAll();
        $results     = (new SessionResultsModel())->where('qa_run_id', $qaRunId)->findAll();
        $validations = (new ValidationResultsModel())->where('qa_run_id', $qaRunId)->findAll();
        $decisions   = (new RunDecisionsModel())->where('qa_run_id', $qaRunId)->orderBy('created_at')->findAll();
        $fileIo      = (new FileIoTestsModel())->forRun($qaRunId);
        $reports     = (new ReportsModel())->where('qa_run_id', $qaRunId)->where('kind', 'session')->findAll();

        $resultsBySession = [];
        foreach ($results as $r) {
            $resultsBySession[$r['session_id']] = $r;
        }
        $reportBySession = [];
        foreach ($reports as $report) {
            if (! empty($report['session_id'])) {
                $reportBySession[(int) $report['session_id']] = $report;
            }
        }

        $totals = $this->summarise($sessions, $results, $validations);

        $json = [
            'qa_run_id'    => $qaRunId,
            'kind'         => 'final',
            'run'          => $run,
            'environment'  => [
                'value'         => Environments::normalize((string) ($run['environment'] ?? '')),
                'label'         => Environments::label((string) ($run['environment'] ?? '')),
                'observer_only' => Environments::isObserverOnly((string) ($run['environment'] ?? '')),
            ],
            'totals'       => $totals,
            'top_errors'   => $this->topErrors($validations),
            'sessions'     => array_map(static function ($s) use ($resultsBySession, $reportBySession) {
                $sid = (int) $s['id'];
                $s['result'] = $resultsBySession[$s['id']] ?? null;
                $s['report'] = isset($reportBySession[$sid])
                    ? [
                        'html_url'    => 'api/v1/reports/session/' . $sid . '/html',
                        'json_url'    => 'api/v1/reports/session/' . $sid . '/json',
                        'prompts_url' => 'api/v1/reports/session/' . $sid . '/prompts',
                    ]
                    : null;
                return $s;
            }, $sessions),
            'validations'  => $validations,
            'decisions_taken' => $decisions,
            'file_io_tests'   => $fileIo,
            'file_io_summary' => FileIoTestsModel::summarise($fileIo),
            'generated_at' => gmdate('c'),
        ];
        $json['human_summary'] = $this->runHumanSummary($json);

        return ['ok' => true, 'json' => $json, 'totals' => $totals, 'run' => $run];
    }

    /**
     * Plain-English "what broke" for the top of a session report.
     *
     * @param array<string, mixed> $json
     */
    private function sessionHumanSummary(array $json): string
    {
        $session = (array) ($json['session'] ?? []);
        $result  = (array) ($json['result'] ?? []);
        $status  = (string) ($result['status'] ?? $session['status'] ?? 'unknown');
        $name    = (string) ($session['name'] ?? 'This session');

        $failed = array_values(array_filter(
            (array) ($json['validations'] ?? []),
            static fn ($v): bool => empty($v['passed'])
        ));
        $steps   = (array) ($json['failed_steps'] ?? []);
        $fileIo  = (array) ($json['file_io_tests'] ?? []);
        $badIo   = array_values(array_filter(
            $fileIo,
            static fn ($t): bool => in_array((string) ($t['compare_status'] ?? ''), ['fail', 'partial'], true)
        ));

        if ($failed === [] && $steps === [] && $badIo === []) {
            return $name . ' completed with status "' . $status . '". No errors, no failed validations, '
                . 'and no data mismatches were detected.';
        }

        $parts = [$name . ' finished with status "' . $status . '".'];

        if ($steps !== []) {
            $first = $steps[0];
            $parts[] = 'The workflow broke at step "' . ($first['kind'] ?? 'unknown') . '": '
                . ($first['error'] ?? 'no error text was captured') . '.';
        }

        if ($failed !== []) {
            $codes = array_slice(array_values(array_unique(array_map(
                static fn ($v): string => (string) ($v['rule_code'] ?? 'UNKNOWN'),
                $failed
            ))), 0, 5);
            $parts[] = count($failed) . ' validation(s) failed (' . implode(', ', $codes) . ').';
            $first = $failed[0];
            if (! empty($first['expected']) || ! empty($first['actual'])) {
                $parts[] = 'For example, ' . ($first['rule_code'] ?? 'a rule') . ' expected "'
                    . ($first['expected'] ?? '') . '" but the application produced "'
                    . ($first['actual'] ?? '') . '".';
            }
        }

        if ($badIo !== []) {
            $mismatched = array_sum(array_map(
                static fn ($t): int => (int) ($t['mismatched_cells'] ?? 0),
                $badIo
            ));
            $parts[] = count($badIo) . ' file I/O scenario(s) did not round-trip cleanly'
                . ($mismatched > 0 ? ', with ' . $mismatched . ' cell value(s) changed between upload and export' : '')
                . '.';
        }

        return implode(' ', $parts);
    }

    /** @param array<string, mixed> $json */
    private function runHumanSummary(array $json): string
    {
        $totals = (array) ($json['totals'] ?? []);
        $io     = (array) ($json['file_io_summary'] ?? []);
        $run    = (array) ($json['run'] ?? []);

        $parts = [
            'QA run ' . ($json['qa_run_id'] ?? '') . ' on ' . ($run['product_name'] ?? 'the product')
            . ' (' . Environments::label((string) ($run['environment'] ?? '')) . ') executed '
            . (int) ($totals['total'] ?? 0) . ' session(s): ' . (int) ($totals['passed'] ?? 0) . ' passed, '
            . (int) ($totals['failed'] ?? 0) . ' failed, ' . (int) ($totals['skipped'] ?? 0) . ' skipped.',
        ];

        $top = (array) ($json['top_errors'] ?? []);
        if ($top !== []) {
            $first = $top[0];
            $parts[] = 'The most frequent error is ' . ($first['rule_code'] ?? 'unknown') . ' ('
                . (int) ($first['count'] ?? 0) . ' occurrence(s)).';
        }

        if ((int) ($io['total'] ?? 0) > 0) {
            $parts[] = 'File I/O: ' . (int) ($io['by_status']['pass'] ?? 0) . ' of ' . (int) $io['total']
                . ' scenario(s) passed'
                . ($io['pass_rate'] !== null ? ' (' . $io['pass_rate'] . '% pass rate)' : '')
                . ', with ' . (int) ($io['mismatched_cells'] ?? 0) . ' mismatched cell(s) across '
                . (int) ($io['data_verifiable'] ?? 0) . ' data-verifiable artifact(s).';
        }

        return implode(' ', $parts);
    }

    /**
     * @param list<array<string, mixed>> $validations
     * @return list<array<string, mixed>>
     */
    private function topErrors(array $validations): array
    {
        $grouped = [];
        foreach ($validations as $validation) {
            if (! empty($validation['passed'])) {
                continue;
            }
            $code = (string) ($validation['rule_code'] ?? 'UNKNOWN');
            $grouped[$code] ??= [
                'rule_code' => $code,
                'count'     => 0,
                'severity'  => (string) ($validation['severity'] ?? 'medium'),
                'expected'  => $validation['expected'] ?? null,
                'actual'    => $validation['actual'] ?? null,
            ];
            $grouped[$code]['count']++;
        }

        usort($grouped, static fn (array $a, array $b): int => $b['count'] <=> $a['count']);

        return array_slice(array_values($grouped), 0, 10);
    }

    /**
     * Inline screenshots as data URIs so the HTML report stays portable when
     * downloaded or emailed. Large captures are linked, not embedded.
     *
     * @param array<string, mixed>|null $result
     * @return list<array<string, mixed>>
     */
    private function collectEvidence(?array $result): array
    {
        $paths = (array) ($result['screenshot_paths'] ?? []);
        $out   = [];
        $budget = 12 * 1024 * 1024; // total embed budget for one report

        foreach ($paths as $path) {
            $path = (string) $path;
            if ($path === '') {
                continue;
            }
            $item = ['name' => basename($path), 'path' => $path, 'embedded' => false, 'data_uri' => null];

            if (is_file($path)) {
                $size = (int) @filesize($path);
                if ($size > 0 && $size <= 3 * 1024 * 1024 && $size <= $budget) {
                    $bytes = @file_get_contents($path);
                    if ($bytes !== false) {
                        $mime = str_ends_with(strtolower($path), '.jpg') || str_ends_with(strtolower($path), '.jpeg')
                            ? 'image/jpeg'
                            : 'image/png';
                        $item['data_uri'] = 'data:' . $mime . ';base64,' . base64_encode($bytes);
                        $item['embedded'] = true;
                        $budget -= $size;
                    }
                }
                $item['bytes'] = $size;
            }

            $out[] = $item;
        }

        return $out;
    }

    private function writeReportFiles(string $dir, string $jsonPath, string $jsonBody, string $htmlPath, string $htmlBody): bool
    {
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            log_message('error', 'ReportService: cannot create reports directory {dir}', ['dir' => $dir]);

            return false;
        }

        $jsonOk = @file_put_contents($jsonPath, $jsonBody) !== false;
        $htmlOk = @file_put_contents($htmlPath, $htmlBody) !== false;

        if (! $jsonOk || ! $htmlOk) {
            log_message('error', 'ReportService: failed writing report files under {dir}', ['dir' => $dir]);

            return false;
        }

        return true;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function upsertReportRow(array $row, string $kind, ?int $sessionId = null, ?string $qaRunId = null): int|string
    {
        $reports = new ReportsModel();

        if ($kind === 'session' && $sessionId !== null) {
            $existing = $reports->where('session_id', $sessionId)->where('kind', 'session')
                ->orderBy('generated_at', 'DESC')->first();
        } else {
            $existing = $reports->where('qa_run_id', $qaRunId ?? $row['qa_run_id'])
                ->where('kind', 'final')
                ->orderBy('generated_at', 'DESC')->first();
        }

        if ($existing) {
            $reports->update($existing['id'], $row);

            return $existing['id'];
        }

        return $reports->insert($row, true);
    }

    private function summarise(array $sessions, array $results, array $validations): array
    {
        $total   = count($sessions);
        $passed  = 0;
        $failed  = 0;
        $skipped = 0;
        $moduleStats = [];
        $sevStats    = ['critical' => 0, 'high' => 0, 'medium' => 0, 'low' => 0, 'warning' => 0];
        $bySessionId = [];

        foreach ($results as $r) {
            $bySessionId[$r['session_id']] = $r;
        }

        foreach ($sessions as $s) {
            $r = $bySessionId[$s['id']] ?? null;
            $st = $r['status'] ?? $s['status'] ?? 'queued';
            if ($st === 'passed' || $s['status'] === 'completed' && ($r['status'] ?? null) !== 'failed') {
                $passed++;
            } elseif ($st === 'failed' || $s['status'] === 'failed') {
                $failed++;
            } elseif ($st === 'skipped' || $s['status'] === 'skipped' || $s['status'] === 'blocked_by_safe_guard') {
                $skipped++;
            }

            $sev = $r['severity'] ?? 'low';
            if (isset($sevStats[$sev])) {
                $sevStats[$sev] += ($st === 'failed' ? 1 : 0);
            }

            $m = $s['module'] ?? 'Unknown';
            $moduleStats[$m] ??= ['passed' => 0, 'failed' => 0, 'skipped' => 0];
            if ($st === 'failed') {
                $moduleStats[$m]['failed']++;
            } elseif ($st === 'skipped') {
                $moduleStats[$m]['skipped']++;
            } else {
                $moduleStats[$m]['passed']++;
            }
        }

        $failedValidations = array_values(array_filter($validations, static fn ($v) => empty($v['passed'])));

        return [
            'total'              => $total,
            'passed'             => $passed,
            'failed'             => $failed,
            'skipped'            => $skipped,
            'severity'           => $sevStats,
            'modules'            => $moduleStats,
            'failed_validations' => $failedValidations,
        ];
    }

    private function sessionDir(array $session, ?array $run): string
    {
        $product = $run['product_name'] ?? 'unknown';
        $day     = substr($session['qa_run_id'], 7, 8);
        $date    = $day !== ''
            ? substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2)
            : gmdate('Y-m-d');
        $base    = $this->reportsRoot();
        $slug    = 'session-' . str_pad((string) ($session['order_index'] ?? $session['id']), 3, '0', STR_PAD_LEFT)
                 . '-' . preg_replace('/[^a-z0-9]+/i', '-', strtolower($session['name']));
        return $base . '/' . $product . '/' . $date . '/' . $session['qa_run_id'] . '/' . $slug;
    }

    private function runDir(array $run): string
    {
        $day  = substr($run['qa_run_id'], 7, 8);
        $date = $day !== ''
            ? substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2)
            : gmdate('Y-m-d');
        return $this->reportsRoot() . '/' . ($run['product_name'] ?? 'unknown') . '/' . $date . '/' . $run['qa_run_id'];
    }

    public function reportsRoot(): string
    {
        $dir = trim((string) env('QA_REPORTS_DIR', ''));
        if ($dir === '') {
            $dir = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'qa-reports';
        }

        $isAbsolute = str_starts_with($dir, '/') || (bool) preg_match('#^[A-Za-z]:[\\\\/]#', $dir);
        if (! $isAbsolute) {
            $base = dirname(__DIR__, 2); // server-php/
            $dir  = $base . DIRECTORY_SEPARATOR . $dir;
        }

        $resolved = realpath($dir);
        if ($resolved !== false) {
            return $resolved;
        }

        return rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $dir), '/\\');
    }

    /**
     * Locate on-disk folder for a QA run (product/date/qa_run_id), with fallbacks
     * when product casing/path differs from the DB value.
     */
    public function findRunDirectory(string $qaRunId, ?string $productName = null): ?string
    {
        $qaRunId = trim($qaRunId);
        if ($qaRunId === '') {
            return null;
        }

        $root = $this->reportsRoot();
        $day  = substr($qaRunId, 7, 8);
        $date = $day !== '' && ctype_digit($day)
            ? substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2)
            : null;

        $candidates = [];
        if ($productName && $date) {
            $candidates[] = $root . '/' . $productName . '/' . $date . '/' . $qaRunId;
        }
        if ($date) {
            foreach (glob($root . '/*/' . $date . '/' . $qaRunId) ?: [] as $path) {
                $candidates[] = $path;
            }
        }
        foreach (glob($root . '/*/*/' . $qaRunId) ?: [] as $path) {
            $candidates[] = $path;
        }

        foreach ($candidates as $path) {
            if (is_dir($path)) {
                return rtrim(str_replace('\\', '/', $path), '/');
            }
        }

        return null;
    }

    /** Worker upload folder: …/session-NNN/screenshots */
    public function sessionScreenshotsDirectory(array $session, ?array $run = null): string
    {
        $run ??= (new RunsModel())->find($session['qa_run_id'] ?? '') ?: [];
        $product = $run['product_name'] ?? 'unknown';
        $qaRunId = (string) ($session['qa_run_id'] ?? '');
        $day     = substr($qaRunId, 7, 8);
        $date    = $day !== '' && ctype_digit($day)
            ? substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2)
            : gmdate('Y-m-d');
        $order   = str_pad((string) ($session['order_index'] ?? $session['id'] ?? 0), 3, '0', STR_PAD_LEFT);

        $existing = $this->findRunDirectory($qaRunId, $product);
        $base     = $existing ?: ($this->reportsRoot() . '/' . $product . '/' . $date . '/' . $qaRunId);

        return $base . '/session-' . $order . '/screenshots';
    }

    /** Worker upload folder for file I/O artifacts: …/session-NNN/file-io */
    public function sessionFileIoDirectory(array $session, ?array $run = null): string
    {
        return dirname($this->sessionScreenshotsDirectory($session, $run)) . '/file-io';
    }

    /** Recursively delete the run folder (screenshots, reports, logs) from disk. */
    public function deleteRunArtifacts(string $qaRunId, ?string $productName = null): bool
    {
        $dir = $this->findRunDirectory($qaRunId, $productName);
        if ($dir === null || ! is_dir($dir)) {
            return false;
        }
        $this->deleteTree($dir);

        return ! is_dir($dir);
    }

    private function deleteTree(string $path): void
    {
        if (is_file($path)) {
            @unlink($path);

            return;
        }
        if (! is_dir($path)) {
            return;
        }

        $items = scandir($path) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $full = $path . DIRECTORY_SEPARATOR . $item;
            if (is_dir($full)) {
                $this->deleteTree($full);
            } else {
                @unlink($full);
            }
        }
        @rmdir($path);
    }

    private function renderSessionHtml(array $json): string
    {
        $session   = $json['session'];
        $result    = $json['result'] ?? [];
        $valids    = $json['validations'] ?? [];
        $decisionRows = $this->renderDecisionRows($json['decisions_taken'] ?? []);

        $valRows = '';
        foreach ($valids as $v) {
            $valRows .= sprintf(
                '<tr class="%s"><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                empty($v['passed']) ? 'fail' : 'pass',
                empty($v['passed']) ? 'FAIL' : 'pass',
                htmlspecialchars((string) $v['rule_code']),
                htmlspecialchars((string) $v['severity']),
                htmlspecialchars((string) ($v['expected'] ?? '')),
                htmlspecialchars((string) ($v['actual'] ?? '')),
                htmlspecialchars((string) ($v['notes'] ?? ''))
            );
        }

        $stepRows = '';
        foreach ((array) ($json['failed_steps'] ?? []) as $step) {
            $stepRows .= sprintf(
                '<tr class="fail"><td>%s</td><td>%s</td><td>%s</td></tr>',
                htmlspecialchars((string) ($step['index'] ?? '')),
                htmlspecialchars((string) ($step['kind'] ?? '')),
                htmlspecialchars((string) ($step['error'] ?? ''))
            );
        }

        return $this->htmlShell(
            'QA Session — ' . ($session['name'] ?? ''),
            sprintf(
                '<h1>QA Session Report</h1>
                 <p class="muted">%s · %s · %s · %s</p>
                 <h2>%s</h2>
                 <p>Severity: <span class="badge sev-%s">%s</span> · Status: <strong>%s</strong></p>
                 <div class="summary"><strong>What happened:</strong> %s</div>
                 <h3>Failed steps</h3>
                 <table><thead><tr><th>#</th><th>Step</th><th>Error</th></tr></thead><tbody>%s</tbody></table>
                 <h3>Validations</h3>
                 <table><thead><tr><th>Result</th><th>Rule</th><th>Severity</th><th>Expected</th><th>Actual</th><th>Notes</th></tr></thead><tbody>%s</tbody></table>
                 <h3>File I/O &amp; data verification</h3>
                 %s
                 <h3>Decisions taken</h3>
                 <table><thead><tr><th>Situation</th><th>Choice</th><th>Source</th><th>Status</th></tr></thead><tbody>%s</tbody></table>
                 <h3>Evidence</h3>
                 %s
                 <h3>Developer prompt pack</h3>
                 <pre class="md">%s</pre>
                 <h3>Result JSON</h3>
                 <pre>%s</pre>',
                htmlspecialchars((string) $session['qa_run_id']),
                htmlspecialchars((string) ($json['environment']['label'] ?? '')),
                htmlspecialchars((string) ($session['module'] ?? '')),
                htmlspecialchars((string) ($session['sub_module'] ?? '')),
                htmlspecialchars((string) $session['name']),
                htmlspecialchars((string) ($result['severity'] ?? 'low')),
                htmlspecialchars((string) ($result['severity'] ?? 'low')),
                htmlspecialchars((string) ($result['status'] ?? $session['status'])),
                htmlspecialchars((string) ($json['human_summary'] ?? '')),
                $stepRows ?: '<tr><td colspan="3" class="muted">No step failed.</td></tr>',
                $valRows ?: '<tr><td colspan="6" class="muted">No validations recorded.</td></tr>',
                $this->renderFileIoTable((array) ($json['file_io_tests'] ?? []), (array) ($json['file_io_summary'] ?? [])),
                $decisionRows,
                $this->renderEvidence((array) ($json['evidence'] ?? [])),
                htmlspecialchars((string) ($json['developer_prompt_pack'] ?? '')),
                htmlspecialchars(json_encode($result['result_json'] ?? [], JSON_PRETTY_PRINT))
            )
        );
    }

    /**
     * @param list<array<string, mixed>> $tests
     * @param array<string, mixed>       $summary
     */
    private function renderFileIoTable(array $tests, array $summary): string
    {
        if ($tests === []) {
            return '<p class="muted">No file I/O scenario ran for this scope.</p>';
        }

        $rows = '';
        foreach ($tests as $test) {
            $status = (string) ($test['compare_status'] ?? '');
            $verified = $test['data_verified'] ?? null;
            $rows .= sprintf(
                '<tr class="%s"><td>%s</td><td>%s</td><td class="status status-%s">%s</td>'
                . '<td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                in_array($status, ['fail', 'partial'], true) ? 'fail' : 'pass',
                htmlspecialchars((string) ($test['scenario_key'] ?? '')),
                htmlspecialchars((string) ($test['direction'] ?? '')),
                htmlspecialchars($status),
                htmlspecialchars($status),
                htmlspecialchars((string) ($test['result_mime'] ?? '—')),
                htmlspecialchars(($test['rows_expected'] ?? '—') . ' / ' . ($test['rows_found'] ?? '—')),
                htmlspecialchars((string) ((int) ($test['mismatched_cells'] ?? 0))),
                htmlspecialchars($verified === null ? 'n/a' : ($verified ? 'verified' : 'MISMATCH')),
                htmlspecialchars((string) ($test['verification_notes'] ?? $test['structure_notes'] ?? ''))
            );
        }

        $head = sprintf(
            '<p class="muted">%d scenario(s), %s pass rate, %d mismatched cell(s).</p>',
            (int) ($summary['total'] ?? count($tests)),
            $summary['pass_rate'] === null ? 'n/a' : ($summary['pass_rate'] . '%'),
            (int) ($summary['mismatched_cells'] ?? 0)
        );

        return $head . '<table><thead><tr><th>Scenario</th><th>Direction</th><th>Status</th><th>MIME</th>'
            . '<th>Rows exp/found</th><th>Bad cells</th><th>Data</th><th>Notes</th></tr></thead><tbody>'
            . $rows . '</tbody></table>';
    }

    /** @param list<array<string, mixed>> $evidence */
    private function renderEvidence(array $evidence): string
    {
        if ($evidence === []) {
            return '<p class="muted">No screenshots were captured.</p>';
        }

        $out = '<div class="shots">';
        foreach ($evidence as $item) {
            $name = htmlspecialchars((string) ($item['name'] ?? 'evidence'));
            if (! empty($item['data_uri'])) {
                $out .= '<figure><img src="' . $item['data_uri'] . '" alt="' . $name . '"><figcaption>'
                    . $name . '</figcaption></figure>';
            } else {
                $out .= '<figure class="missing"><figcaption>' . $name
                    . ' <span class="muted">(not embedded — open from the portal)</span></figcaption></figure>';
            }
        }

        return $out . '</div>';
    }

    private function renderFinalHtml(array $json): string
    {
        $totals = $json['totals'];
        $rows = '';
        foreach ($json['sessions'] as $s) {
            $r = $s['result'] ?? [];
            $status = $r['status'] ?? $s['status'] ?? 'queued';
            $link = ! empty($s['report']['html_url'])
                ? '<a href="/' . htmlspecialchars((string) $s['report']['html_url']) . '">Open</a>'
                : '<span class="muted">—</span>';
            $rows .= sprintf(
                '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td class="status status-%s">%s</td><td>%s</td><td>%s</td></tr>',
                htmlspecialchars((string) $s['order_index']),
                htmlspecialchars((string) $s['name']),
                htmlspecialchars((string) ($s['module'] ?? '')),
                htmlspecialchars((string) ($s['sub_module'] ?? '')),
                htmlspecialchars($status),
                htmlspecialchars($status),
                htmlspecialchars((string) ($r['severity'] ?? '')),
                $link
            );
        }

        $errorRows = '';
        foreach ((array) ($json['top_errors'] ?? []) as $error) {
            $errorRows .= sprintf(
                '<tr class="fail"><td>%s</td><td>%d</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                htmlspecialchars((string) ($error['rule_code'] ?? '')),
                (int) ($error['count'] ?? 0),
                htmlspecialchars((string) ($error['severity'] ?? '')),
                htmlspecialchars((string) ($error['expected'] ?? '')),
                htmlspecialchars((string) ($error['actual'] ?? ''))
            );
        }

        $sev = $totals['severity'] ?? [];
        $decisionRows = $this->renderDecisionRows($json['decisions_taken'] ?? []);

        return $this->htmlShell(
            'QA Consolidated Report — ' . ($json['qa_run_id'] ?? ''),
            sprintf(
                '<h1>QA Consolidated Report</h1>
                 <p class="muted">%s · %s · %s</p>
                 <div class="summary"><strong>Summary:</strong> %s</div>
                 <div class="cards">
                    <div class="card"><div class="k">%d</div><div class="v">Sessions</div></div>
                    <div class="card pass"><div class="k">%d</div><div class="v">Passed</div></div>
                    <div class="card fail"><div class="k">%d</div><div class="v">Failed</div></div>
                    <div class="card skip"><div class="k">%d</div><div class="v">Skipped</div></div>
                    <div class="card critical"><div class="k">%d</div><div class="v">Critical</div></div>
                    <div class="card high"><div class="k">%d</div><div class="v">High</div></div>
                 </div>
                 <table><thead><tr><th>#</th><th>Session</th><th>Module</th><th>Sub-module</th><th>Status</th><th>Severity</th><th>Report</th></tr></thead><tbody>%s</tbody></table>
                 <h3>Top errors</h3>
                 <table><thead><tr><th>Rule</th><th>Count</th><th>Severity</th><th>Expected</th><th>Actual</th></tr></thead><tbody>%s</tbody></table>
                 <h3>File I/O &amp; data verification</h3>
                 %s
                 <h3>Decisions taken</h3>
                 <table><thead><tr><th>Situation</th><th>Choice</th><th>Source</th><th>Status</th></tr></thead><tbody>%s</tbody></table>
                 <h3>Developer prompt pack</h3>
                 <pre class="md">%s</pre>',
                htmlspecialchars($json['qa_run_id'] ?? ''),
                htmlspecialchars($json['run']['product_name'] ?? ''),
                htmlspecialchars((string) ($json['environment']['label'] ?? $json['run']['environment'] ?? '')),
                htmlspecialchars((string) ($json['human_summary'] ?? '')),
                (int) ($totals['total'] ?? 0),
                (int) ($totals['passed'] ?? 0),
                (int) ($totals['failed'] ?? 0),
                (int) ($totals['skipped'] ?? 0),
                (int) ($sev['critical'] ?? 0),
                (int) ($sev['high'] ?? 0),
                $rows,
                $errorRows ?: '<tr><td colspan="5" class="muted">No validation failed.</td></tr>',
                $this->renderFileIoTable((array) ($json['file_io_tests'] ?? []), (array) ($json['file_io_summary'] ?? [])),
                $decisionRows,
                htmlspecialchars((string) ($json['developer_prompt_pack'] ?? ''))
            )
        );
    }

    private function renderDecisionRows(array $decisions): string
    {
        if ($decisions === []) {
            return '<tr><td colspan="4" class="muted">No decisions were required.</td></tr>';
        }
        $rows = '';
        foreach ($decisions as $decision) {
            $rows .= sprintf(
                '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                htmlspecialchars((string) ($decision['situation_key'] ?? '')),
                htmlspecialchars((string) ($decision['selected_option'] ?? '—')),
                htmlspecialchars(($decision['source'] ?? 'human') === 'memory' ? 'Remembered' : 'Human'),
                htmlspecialchars((string) ($decision['status'] ?? ''))
            );
        }

        return $rows;
    }

    private function htmlShell(string $title, string $body): string
    {
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' . htmlspecialchars($title) . '</title>
<style>
:root{--g:#16a34a;--g50:#f0fdf4;--ink:#111;--mid:#555;--mut:#888;--line:#e5e7eb;--red:#dc2626;--ylw:#d97706;--gry:#6b7280}
*{box-sizing:border-box}html,body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;color:var(--ink);background:#fff}
.container{max-width:1200px;margin:0 auto;padding:32px 24px}h1{margin:0 0 4px;font-size:24px;font-weight:700}
h2{margin:24px 0 8px;font-size:20px;color:var(--g)}h3{margin:24px 0 8px;font-size:16px}
.muted{color:var(--mut);font-size:14px}.badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;background:var(--g50);color:var(--g)}
.badge.sev-critical{background:#fef2f2;color:var(--red)}.badge.sev-high{background:#fff7ed;color:var(--ylw)}.badge.sev-warning{background:#fff7ed;color:var(--ylw)}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);font-size:14px}
th{background:var(--g50);color:var(--g);font-weight:600}tr.pass td{background:#fff}tr.fail td{background:#fef2f2}
.status{font-weight:600}.status-failed{color:var(--red)}.status-completed,.status-passed{color:var(--g)}.status-skipped{color:var(--gry)}
.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:12px 0 24px}
.card{border:1px solid var(--line);border-radius:12px;padding:14px;background:#fff}
.card .k{font-size:24px;font-weight:700}.card .v{font-size:12px;color:var(--mut)}
.card.pass{border-color:var(--g);color:var(--g)}.card.fail{border-color:var(--red);color:var(--red)}.card.skip{color:var(--gry)}
.card.critical{border-color:var(--red);color:var(--red)}.card.high{border-color:var(--ylw);color:var(--ylw)}
pre{background:#0b1020;color:#e2e8f0;padding:14px;border-radius:8px;overflow:auto;font-size:12px;line-height:1.45}
pre.md{background:#f8fafc;color:#0f172a;border:1px solid var(--line);white-space:pre-wrap}
.summary{border-left:3px solid var(--g);background:var(--g50);padding:12px 14px;border-radius:0 8px 8px 0;margin:12px 0 20px;font-size:14px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:8px}
.shots figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}
.shots img{width:100%;display:block}
.shots figcaption{padding:8px 10px;font-size:12px;color:var(--mid);border-top:1px solid var(--line)}
.shots figure.missing{padding:10px;color:var(--mut);font-size:12px}
</style></head><body><div class="container">' . $body . '<footer style="margin-top:48px;color:#888;font-size:12px">AICOUNTLY QA Portal — testing &amp; reporting only.</footer></div></body></html>';
    }
}
