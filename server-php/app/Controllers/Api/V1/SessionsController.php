<?php

namespace App\Controllers\Api\V1;

use App\Models\AuditLogsModel;
use App\Models\RunsModel;
use App\Models\SessionEventsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\ValidationResultsModel;
use CodeIgniter\RESTful\ResourceController;
use Config\Services;

class SessionsController extends ResourceController
{
    protected $modelName = SessionsModel::class;
    protected $format    = 'json';

    public function index()
    {
        $q = $this->request->getGet();
        if (! empty($q['qa_run_id'])) { $this->model->where('qa_run_id', $q['qa_run_id']); }
        if (! empty($q['status']))    { $this->model->where('status', $q['status']); }
        if (! empty($q['module']))    { $this->model->where('module', $q['module']); }
        $rows = $this->model->orderBy('qa_run_id', 'DESC')->orderBy('order_index')->limit(500)->findAll();
        return $this->respond(['ok' => true, 'data' => $rows]);
    }

    public function show($id = null)
    {
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $row['result']      = (new SessionResultsModel())->where('session_id', $id)->first();
        $row['validations'] = (new ValidationResultsModel())->where('session_id', $id)->findAll();
        return $this->respond(['ok' => true, 'data' => $row]);
    }

    /**
     * Re-queue a finished session so the worker can run it again.
     * Clears prior results, validations, live-log events, session reports, and evidence files.
     */
    public function rerun($id = null)
    {
        $sessionId = (int) $id;
        try {
            $prepared = $this->model->prepareRerun($sessionId);
        } catch (\RuntimeException $e) {
            $code = (int) $e->getCode();
            if (! in_array($code, [400, 404, 409, 500], true)) {
                $code = 400;
            }
            if ($code === 404) {
                return $this->failNotFound($e->getMessage());
            }

            return $this->fail($e->getMessage(), $code);
        }

        $session = $prepared['session'];
        $this->clearSessionEvidenceFiles($session);

        Services::auditService()->log('session_rerun', [
            'qa_run_id'    => $session['qa_run_id'],
            'session_id'   => $sessionId,
            'subject_kind' => 'session',
            'subject_id'   => $sessionId,
            'metadata'     => [
                'previous_status' => $prepared['previous_status'],
                'name'            => $session['name'] ?? null,
            ],
        ]);

        try {
            (new SessionEventsModel())->record(
                $sessionId,
                (string) $session['qa_run_id'],
                'rerun',
                'Session re-queued for another run (was ' . $prepared['previous_status'] . ').',
                ['metadata' => ['previous_status' => $prepared['previous_status']]]
            );
        } catch (\Throwable $e) {
            // Events table optional.
        }

        return $this->respond([
            'ok'   => true,
            'data' => $session,
        ]);
    }

    /**
     * Live activity feed for a session (log lines + screenshots).
     */
    public function live($id = null)
    {
        $sessionId = (int) $id;
        $session   = $this->model->find($sessionId);
        if (! $session) {
            return $this->failNotFound();
        }

        $events = [];
        try {
            $events = (new SessionEventsModel())
                ->where('session_id', $sessionId)
                ->orderBy('id', 'ASC')
                ->limit(300)
                ->findAll();
        } catch (\Throwable $e) {
            // Table may not exist yet before migrate; fall back to audit synthesis.
            $events = [];
        }

        if ($events === []) {
            $events = $this->synthesizeEventsFromAudit($sessionId, (string) $session['qa_run_id'], $session);
        }

        $screenshots = $this->listScreenshots($session);
        $result      = (new SessionResultsModel())->where('session_id', $sessionId)->first();
        $outcome     = $this->buildOutcome($session, $result, $events);

        $lastEvent = $events !== [] ? $events[array_key_last($events)] : null;
        $activity  = is_array($lastEvent) ? (string) ($lastEvent['message'] ?? '') : '';
        if ($activity === '') {
            $activity = (string) ($outcome['detail'] ?? 'No live activity yet.');
        }

        return $this->respond([
            'ok'   => true,
            'data' => [
                'session'           => $session,
                'activity'          => $activity,
                'outcome'           => $outcome,
                'events'            => $events,
                'screenshots'       => $screenshots,
                'result'            => $result,
                'last_heartbeat_at' => $session['last_heartbeat_at'] ?? null,
                'polled_at'         => gmdate('c'),
            ],
        ]);
    }

    /**
     * Serve an evidence file (screenshot) for a session. Filename only — no path traversal.
     * Prefer ?filename=… (avoids cPanel static handlers on URLs ending in .png).
     */
    public function evidence($id = null, $filename = null)
    {
        $sessionId = (int) $id;
        $filename  = basename((string) ($filename ?: $this->request->getGet('filename') ?? ''));
        if ($filename === '' || $filename === '.' || $filename === '..') {
            return $this->fail('Invalid filename.', 400);
        }

        $session = $this->model->find($sessionId);
        if (! $session) {
            return $this->failNotFound();
        }

        $path = $this->findEvidenceFile($session, $filename);
        if ($path === null || ! is_file($path)) {
            return $this->fail('Evidence file not found.', 404);
        }

        $raw  = file_get_contents($path);
        if ($raw === false) {
            return $this->fail('Evidence file unreadable.', 500);
        }

        $ext  = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'png'         => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp'        => 'image/webp',
            'gif'         => 'image/gif',
            default       => (mime_content_type($path) ?: 'application/octet-stream'),
        };

        // Bypass ResourceController JSON formatting for binary payloads.
        $this->format = null;

        return $this->response
            ->setStatusCode(200)
            ->setHeader('Content-Type', $mime)
            ->setHeader('Content-Length', (string) strlen($raw))
            ->setHeader('Cache-Control', 'private, max-age=60')
            ->setHeader('X-Content-Type-Options', 'nosniff')
            ->setBody($raw);
    }

    /** @return list<array<string, mixed>> */
    private function synthesizeEventsFromAudit(int $sessionId, string $qaRunId, array $session): array
    {
        $rows = (new AuditLogsModel())
            ->where('session_id', $sessionId)
            ->orderBy('id', 'ASC')
            ->limit(100)
            ->findAll();

        $events = [];
        foreach ($rows as $row) {
            $meta = $row['metadata'] ?? [];
            if (is_string($meta)) {
                $meta = json_decode($meta, true) ?: [];
            }
            $events[] = [
                'id'         => 'audit-' . $row['id'],
                'session_id' => $sessionId,
                'qa_run_id'  => $qaRunId,
                'event_type' => (string) ($row['event'] ?? 'audit'),
                'message'    => $this->humanizeAuditEvent((string) ($row['event'] ?? ''), $meta, $session),
                'step_key'   => $meta['template'] ?? $meta['kind'] ?? null,
                'step_index' => null,
                'total_steps'=> null,
                'metadata'   => $meta,
                'created_at' => $row['created_at'] ?? null,
            ];
        }

        if ($events === [] && ! empty($session['status'])) {
            $events[] = [
                'id'         => 'status-0',
                'session_id' => $sessionId,
                'qa_run_id'  => $qaRunId,
                'event_type' => 'status',
                'message'    => 'Current status: ' . $session['status'],
                'step_key'   => null,
                'step_index' => null,
                'total_steps'=> null,
                'metadata'   => null,
                'created_at' => $session['updated_at'] ?? $session['started_at'] ?? $session['created_at'] ?? null,
            ];
        }

        return $events;
    }

    /** @param array<string, mixed> $meta */
    private function humanizeAuditEvent(string $event, array $meta, array $session): string
    {
        return match ($event) {
            'session_execution_start' => 'Worker started session: ' . (string) ($session['name'] ?? ''),
            'session_execution_complete' => 'Worker finished session (' . (string) ($meta['status'] ?? 'done') . ').',
            'screenshot_captured' => 'Screenshot captured' . (! empty($meta['kind']) ? ' (' . $meta['kind'] . ')' : '') . '.',
            'target_app_login_credentials_fetched' => 'Fetched target app login credentials.',
            default => $event !== '' ? str_replace('_', ' ', $event) : 'Activity update',
        };
    }

    /** @return list<array{filename: string, kind: string, url: string, created_at: string|null}> */
    private function listScreenshots(array $session): array
    {
        $dirs = $this->evidenceDirs($session);
        $out  = [];
        $seen = [];

        foreach ($dirs as $dir) {
            foreach ($this->listImageFilesRecursive($dir) as $file) {
                $name = basename($file);
                if (isset($seen[$name])) {
                    continue;
                }
                $seen[$name] = true;
                $out[] = [
                    'filename'   => $name,
                    'kind'       => 'screenshot',
                    'url'        => '/v1/sessions/' . (int) $session['id'] . '/evidence?filename=' . rawurlencode($name),
                    'created_at' => date('Y-m-d H:i:s', (int) filemtime($file)),
                ];
            }
        }

        usort($out, static fn ($a, $b) => strcmp((string) $a['created_at'], (string) $b['created_at']));

        return $out;
    }

    /** @return list<string> absolute image file paths */
    private function listImageFilesRecursive(string $dir): array
    {
        $files = [];
        $items = glob(rtrim($dir, '/\\') . '/*') ?: [];
        foreach ($items as $item) {
            if (is_dir($item)) {
                foreach ($this->listImageFilesRecursive($item) as $nested) {
                    $files[] = $nested;
                }
                continue;
            }
            if (! is_file($item)) {
                continue;
            }
            $ext = strtolower(pathinfo($item, PATHINFO_EXTENSION));
            if (in_array($ext, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true)) {
                $files[] = $item;
            }
        }

        return $files;
    }

    /** Delete prior screenshots/reports under session-* folders for a clean re-run. */
    private function clearSessionEvidenceFiles(array $session): void
    {
        foreach ($this->evidenceDirs($session) as $dir) {
            $this->deleteTree($dir);
        }

        // Also remove final report files at run root if present.
        $run = (new RunsModel())->find($session['qa_run_id'] ?? '');
        if (! $run) {
            return;
        }
        $product = $run['product_name'] ?? 'unknown';
        $day     = substr((string) $session['qa_run_id'], 7, 8);
        $date    = $day !== ''
            ? substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2)
            : gmdate('Y-m-d');
        $base = Services::reportService()->reportsRoot()
            . '/' . $product . '/' . $date . '/' . $session['qa_run_id'];
        foreach (['report.html', 'report.json', 'final-report.html', 'final-report.json'] as $name) {
            $path = $base . '/' . $name;
            if (is_file($path)) {
                @unlink($path);
            }
        }
    }

    private function deleteTree(string $path): void
    {
        if (! is_dir($path)) {
            if (is_file($path)) {
                @unlink($path);
            }

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

    /** @return list<string> */
    private function evidenceDirs(array $session): array
    {
        $run = (new RunsModel())->find($session['qa_run_id']);
        $product = $run['product_name'] ?? 'unknown';
        $day     = substr((string) $session['qa_run_id'], 7, 8);
        $date    = $day !== ''
            ? substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2)
            : gmdate('Y-m-d');

        $base = Services::reportService()->reportsRoot()
            . '/' . $product . '/' . $date . '/' . $session['qa_run_id'];

        if (! is_dir($base)) {
            return [];
        }

        $prefix = 'session-' . str_pad((string) ($session['order_index'] ?? $session['id']), 3, '0', STR_PAD_LEFT);
        $dirs   = [];
        foreach (glob($base . '/' . $prefix . '*') ?: [] as $path) {
            if (is_dir($path)) {
                $dirs[] = $path;
            }
        }

        return $dirs;
    }

    private function findEvidenceFile(array $session, string $filename): ?string
    {
        foreach ($this->evidenceDirs($session) as $dir) {
            foreach ($this->listImageFilesRecursive($dir) as $file) {
                if (basename($file) === $filename) {
                    return $file;
                }
            }
        }

        return null;
    }

    /**
     * Clear LOGIN SUCCESS / FAILED banner for the Live Log UI.
     *
     * @param list<array<string, mixed>> $events
     * @return array{state: string, label: string, detail: string}
     */
    private function buildOutcome(array $session, ?array $result, array $events): array
    {
        $status = (string) ($session['status'] ?? '');
        $module = strtolower((string) ($session['module'] ?? ''));
        $isLogin = $module === 'login'
            || str_contains(strtolower((string) ($session['template_code'] ?? '')), 'login');

        if (in_array($status, ['queued', 'claimed', 'running'], true)) {
            return [
                'state'  => 'in_progress',
                'label'  => $isLogin ? 'LOGIN IN PROGRESS' : 'SESSION IN PROGRESS',
                'detail' => $isLogin
                    ? 'Worker is signing in to Smart Books. Wait for LOGIN SUCCESSFUL or LOGIN FAILED.'
                    : 'Worker is still executing this session.',
            ];
        }

        $resStatus = strtolower((string) ($result['status'] ?? $status));
        $failed    = (int) ($result['failed_count'] ?? 0);
        $fatal     = null;
        $rj        = $result['result_json'] ?? null;
        if (is_string($rj)) {
            $rj = json_decode($rj, true);
        }
        if (is_array($rj)) {
            $fatal = $rj['fatal_error'] ?? null;
        }

        $success = in_array($resStatus, ['passed', 'completed'], true)
            || ($resStatus === 'partial' && $failed === 0 && empty($fatal));

        if ($isLogin) {
            if ($success) {
                return [
                    'state'  => 'success',
                    'label'  => 'LOGIN SUCCESSFUL',
                    'detail' => 'Smart Books login completed. You can proceed to other QA modules.',
                ];
            }

            return [
                'state'  => 'failed',
                'label'  => 'LOGIN FAILED',
                'detail' => $fatal
                    ? (string) $fatal
                    : 'Login did not complete successfully. Check credentials, login URL, and screenshots.',
            ];
        }

        if ($success) {
            return [
                'state'  => 'success',
                'label'  => 'SESSION PASSED',
                'detail' => 'Session finished successfully.',
            ];
        }

        return [
            'state'  => 'failed',
            'label'  => 'SESSION FAILED',
            'detail' => $fatal ? (string) $fatal : ('Status: ' . ($resStatus ?: $status)),
        ];
    }
}
