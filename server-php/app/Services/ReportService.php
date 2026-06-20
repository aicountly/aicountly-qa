<?php

namespace App\Services;

use App\Models\ReportsModel;
use App\Models\RunsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\ValidationResultsModel;

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
        $run = (new RunsModel())->find($session['qa_run_id']);

        $dir = $this->sessionDir($session, $run);
        @mkdir($dir, 0775, true);

        $json = [
            'qa_run_id'        => $session['qa_run_id'],
            'session'          => $session,
            'result'           => $result,
            'validations'      => $validations,
            'generated_at'     => gmdate('c'),
        ];

        $jsonPath = $dir . '/report.json';
        $htmlPath = $dir . '/report.html';

        file_put_contents($jsonPath, json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        file_put_contents($htmlPath, $this->renderSessionHtml($json));

        $reportId = (new ReportsModel())->insert([
            'qa_run_id'    => $session['qa_run_id'],
            'session_id'   => $sessionId,
            'kind'         => 'session',
            'product_name' => $run['product_name'] ?? 'unknown',
            'html_path'    => $htmlPath,
            'json_path'    => $jsonPath,
            'generated_at' => date('Y-m-d H:i:s'),
        ], true);

        return ['ok' => true, 'id' => $reportId, 'html' => $htmlPath, 'json' => $jsonPath];
    }

    public function buildFinalReport(string $qaRunId): array
    {
        $run = (new RunsModel())->find($qaRunId);
        if (! $run) {
            return ['ok' => false, 'error' => 'run not found'];
        }

        $sessions    = (new SessionsModel())->where('qa_run_id', $qaRunId)->orderBy('order_index')->findAll();
        $results     = (new SessionResultsModel())->where('qa_run_id', $qaRunId)->findAll();
        $validations = (new ValidationResultsModel())->where('qa_run_id', $qaRunId)->findAll();

        $resultsBySession = [];
        foreach ($results as $r) {
            $resultsBySession[$r['session_id']] = $r;
        }

        $totals = $this->summarise($sessions, $results, $validations);

        $dir = $this->runDir($run);
        @mkdir($dir, 0775, true);

        $json = [
            'qa_run_id'    => $qaRunId,
            'run'          => $run,
            'totals'       => $totals,
            'sessions'     => array_map(static function ($s) use ($resultsBySession) {
                $s['result'] = $resultsBySession[$s['id']] ?? null;
                return $s;
            }, $sessions),
            'validations'  => $validations,
            'generated_at' => gmdate('c'),
        ];

        $jsonPath = $dir . '/consolidated.json';
        $htmlPath = $dir . '/consolidated.html';

        file_put_contents($jsonPath, json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        file_put_contents($htmlPath, $this->renderFinalHtml($json));

        (new RunsModel())->update($qaRunId, [
            'status'       => $totals['failed'] > 0 ? 'failed' : 'completed',
            'completed_at' => date('Y-m-d H:i:s'),
            'summary_json' => json_encode($totals),
        ]);

        $reportId = (new ReportsModel())->insert([
            'qa_run_id'    => $qaRunId,
            'session_id'   => null,
            'kind'         => 'final',
            'product_name' => $run['product_name'] ?? 'unknown',
            'html_path'    => $htmlPath,
            'json_path'    => $jsonPath,
            'generated_at' => date('Y-m-d H:i:s'),
        ], true);

        return ['ok' => true, 'id' => $reportId, 'html' => $htmlPath, 'json' => $jsonPath, 'totals' => $totals];
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
        $dir = (string) env('QA_REPORTS_DIR', __DIR__ . '/../../../qa-reports');
        if (! str_starts_with($dir, '/') && !preg_match('#^[A-Z]:\\\\#i', $dir)) {
            $dir = realpath(__DIR__ . '/../../') . DIRECTORY_SEPARATOR . $dir;
        }
        return rtrim($dir, '/\\');
    }

    private function renderSessionHtml(array $json): string
    {
        $session   = $json['session'];
        $result    = $json['result'] ?? [];
        $valids    = $json['validations'] ?? [];
        $valRows   = '';
        foreach ($valids as $v) {
            $ok = $v['passed'] ? 'pass' : 'fail';
            $valRows .= sprintf(
                '<tr class="%s"><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                htmlspecialchars($ok),
                htmlspecialchars((string) $v['rule_code']),
                htmlspecialchars((string) $v['severity']),
                htmlspecialchars((string) ($v['expected'] ?? '')),
                htmlspecialchars((string) ($v['actual'] ?? '')),
                htmlspecialchars((string) ($v['notes'] ?? ''))
            );
        }
        return $this->htmlShell(
            'QA Session — ' . ($session['name'] ?? ''),
            sprintf(
                '<h1>QA Session Report</h1>
                 <p class="muted">%s · %s · %s</p>
                 <h2>%s</h2>
                 <p>Severity: <span class="badge sev-%s">%s</span> · Status: <strong>%s</strong></p>
                 <h3>Validations</h3>
                 <table><thead><tr><th>Result</th><th>Rule</th><th>Severity</th><th>Expected</th><th>Actual</th><th>Notes</th></tr></thead><tbody>%s</tbody></table>
                 <h3>Result JSON</h3>
                 <pre>%s</pre>',
                htmlspecialchars((string) $session['qa_run_id']),
                htmlspecialchars((string) ($session['module'] ?? '')),
                htmlspecialchars((string) ($session['sub_module'] ?? '')),
                htmlspecialchars((string) $session['name']),
                htmlspecialchars((string) ($result['severity'] ?? 'low')),
                htmlspecialchars((string) ($result['severity'] ?? 'low')),
                htmlspecialchars((string) ($result['status'] ?? $session['status'])),
                $valRows ?: '<tr><td colspan="6" class="muted">No validations recorded.</td></tr>',
                htmlspecialchars(json_encode($result['result_json'] ?? [], JSON_PRETTY_PRINT))
            )
        );
    }

    private function renderFinalHtml(array $json): string
    {
        $totals = $json['totals'];
        $rows = '';
        foreach ($json['sessions'] as $s) {
            $r = $s['result'] ?? [];
            $status = $r['status'] ?? $s['status'] ?? 'queued';
            $rows .= sprintf(
                '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td class="status status-%s">%s</td><td>%s</td></tr>',
                htmlspecialchars((string) $s['order_index']),
                htmlspecialchars((string) $s['name']),
                htmlspecialchars((string) ($s['module'] ?? '')),
                htmlspecialchars((string) ($s['sub_module'] ?? '')),
                htmlspecialchars($status),
                htmlspecialchars($status),
                htmlspecialchars((string) ($r['severity'] ?? ''))
            );
        }
        $sev = $totals['severity'] ?? [];
        return $this->htmlShell(
            'QA Consolidated Report — ' . ($json['qa_run_id'] ?? ''),
            sprintf(
                '<h1>QA Consolidated Report</h1>
                 <p class="muted">%s · %s · %s</p>
                 <div class="cards">
                    <div class="card"><div class="k">%d</div><div class="v">Sessions</div></div>
                    <div class="card pass"><div class="k">%d</div><div class="v">Passed</div></div>
                    <div class="card fail"><div class="k">%d</div><div class="v">Failed</div></div>
                    <div class="card skip"><div class="k">%d</div><div class="v">Skipped</div></div>
                    <div class="card critical"><div class="k">%d</div><div class="v">Critical</div></div>
                    <div class="card high"><div class="k">%d</div><div class="v">High</div></div>
                 </div>
                 <table><thead><tr><th>#</th><th>Session</th><th>Module</th><th>Sub-module</th><th>Status</th><th>Severity</th></tr></thead><tbody>%s</tbody></table>',
                htmlspecialchars($json['qa_run_id'] ?? ''),
                htmlspecialchars($json['run']['product_name'] ?? ''),
                htmlspecialchars($json['run']['environment'] ?? ''),
                (int) ($totals['total'] ?? 0),
                (int) ($totals['passed'] ?? 0),
                (int) ($totals['failed'] ?? 0),
                (int) ($totals['skipped'] ?? 0),
                (int) ($sev['critical'] ?? 0),
                (int) ($sev['high'] ?? 0),
                $rows
            )
        );
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
</style></head><body><div class="container">' . $body . '<footer style="margin-top:48px;color:#888;font-size:12px">AICOUNTLY QA Portal — testing &amp; reporting only.</footer></div></body></html>';
    }
}
