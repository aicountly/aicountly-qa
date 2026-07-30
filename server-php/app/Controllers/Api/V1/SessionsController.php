<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseResourceApiController;
use App\Models\AuditLogsModel;
use App\Models\RunsModel;
use App\Models\SessionEventsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\ValidationResultsModel;
use Config\Services;

class SessionsController extends BaseResourceApiController
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
     * Clears DB results/validations/live-log events for a fresh attempt, but keeps
     * screenshots on disk until the whole QA run is deleted.
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
                'Session re-queued for another run (was ' . $prepared['previous_status']
                    . '). Previous screenshots are kept until the QA run is deleted.',
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
     * Hard-delete one session: DB rows plus its on-disk evidence folder.
     * Refused while the worker still holds a lease on it.
     */
    public function delete($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden('Only an Owner can delete a QA session.');
        }

        $sessionId = (int) $id;
        $session   = $this->model->find($sessionId);
        if (! $session) {
            return $this->failNotFound();
        }

        $status = (string) ($session['status'] ?? '');
        if (in_array($status, SessionsModel::LEASED, true)) {
            return $this->fail(
                'Cannot delete a session while it is ' . $status
                . '. Cancel the QA run (or wait for the lease to expire) first.',
                409
            );
        }

        $run = (new RunsModel())->find($session['qa_run_id']);
        $dir = dirname(Services::reportService()->sessionScreenshotsDirectory($session, $run ?: null));
        $removedDir = $this->removeTree($dir);

        $db = $this->model->db;
        $db->transStart();
        foreach ([
            'qa_validation_results',
            'qa_session_results',
            'qa_session_events',
            'qa_run_decisions',
            'qa_file_io_tests',
            'qa_reports',
        ] as $table) {
            try {
                $db->table($table)->where('session_id', $sessionId)->delete();
            } catch (\Throwable $e) {
                // Optional tables on older deploys — the FK cascade covers the rest.
            }
        }
        $this->model->delete($sessionId);
        $db->transComplete();

        if (! $db->transStatus()) {
            return $this->fail('Failed to delete the QA session.', 500);
        }

        Services::auditService()->log('session_delete', [
            'qa_run_id'    => $session['qa_run_id'],
            'session_id'   => $sessionId,
            'subject_kind' => 'session',
            'subject_id'   => $sessionId,
            'metadata'     => ['directory_removed' => $removedDir, 'previous_status' => $status],
        ]);

        return $this->respondDeleted(['ok' => true, 'data' => ['directory_removed' => $removedDir]]);
    }

    /** Only ever called with a path built from the reports root. */
    private function removeTree(string $dir): bool
    {
        $root = Services::reportService()->reportsRoot();
        $real = realpath($dir);
        if ($real === false || ! is_dir($real) || ! str_starts_with($real, $root) || $real === $root) {
            return false;
        }

        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($real, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($items as $item) {
            $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($real);

        return ! is_dir($real);
    }

    private function roleAllowed(array $roles): bool
    {
        $user = $this->request->qaUser ?? null;

        return $user && (bool) array_intersect($roles, (array) ($user['roles'] ?? []));
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

        $screenshots = $this->listScreenshots($session, $events);
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

    /**
     * @param list<array<string, mixed>> $events
     * @return list<array{filename: string, kind: string, url: string, created_at: string|null}>
     */
    private function listScreenshots(array $session, array $events = []): array
    {
        $out  = [];
        $seen = [];

        foreach ($this->collectSessionImageFiles($session, $events) as $file) {
            $name = basename($file);
            if (isset($seen[$name])) {
                continue;
            }
            $seen[$name] = true;
            $out[] = [
                'filename'   => $name,
                'kind'       => 'screenshot',
                'url'        => '/v1/sessions/' . (int) $session['id'] . '/evidence?filename=' . rawurlencode($name),
                // ISO-8601 UTC so the portal can render Asia/Kolkata correctly.
                'created_at' => gmdate('c', (int) @filemtime($file)),
            ];
        }

        usort($out, static fn ($a, $b) => strcmp((string) $a['created_at'], (string) $b['created_at']));

        return $out;
    }

    /**
     * Gather screenshot files from the run folder and from evidence event metadata paths.
     *
     * @param list<array<string, mixed>> $events
     * @return list<string>
     */
    private function collectSessionImageFiles(array $session, array $events = []): array
    {
        $files = [];
        foreach ($this->evidenceDirs($session) as $dir) {
            foreach ($this->listImageFilesRecursive($dir) as $file) {
                $files[] = $file;
            }
        }

        // Fallback: resolve absolute paths recorded when the worker uploaded evidence.
        foreach ($events as $ev) {
            if (($ev['event_type'] ?? '') !== 'evidence') {
                continue;
            }
            $meta = $ev['metadata'] ?? [];
            if (is_string($meta)) {
                $meta = json_decode($meta, true) ?: [];
            }
            if (! is_array($meta)) {
                continue;
            }
            $path = (string) ($meta['path'] ?? '');
            if ($path !== '' && is_file($path) && $this->isImagePath($path)) {
                $files[] = $path;
            }
        }

        return array_values(array_unique($files));
    }

    /** @return list<string> absolute image file paths */
    private function listImageFilesRecursive(string $dir): array
    {
        $files = [];
        if (! is_dir($dir)) {
            return $files;
        }
        $items = glob(rtrim($dir, '/\\') . '/*') ?: [];
        foreach ($items as $item) {
            if (is_dir($item)) {
                foreach ($this->listImageFilesRecursive($item) as $nested) {
                    $files[] = $nested;
                }
                continue;
            }
            if (is_file($item) && $this->isImagePath($item)) {
                $files[] = $item;
            }
        }

        return $files;
    }

    private function isImagePath(string $path): bool
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        return in_array($ext, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true);
    }

    /** @return list<string> */
    private function evidenceDirs(array $session): array
    {
        $run  = (new RunsModel())->find($session['qa_run_id']);
        $base = Services::reportService()->findRunDirectory(
            (string) $session['qa_run_id'],
            isset($run['product_name']) ? (string) $run['product_name'] : null
        );

        if ($base === null || ! is_dir($base)) {
            // Ensure upload path exists as a candidate even if empty.
            $shotDir = Services::reportService()->sessionScreenshotsDirectory($session, $run ?: null);
            $parent  = dirname($shotDir);
            return is_dir($parent) ? [$parent] : (is_dir($shotDir) ? [$shotDir] : []);
        }

        $prefix = 'session-' . str_pad((string) ($session['order_index'] ?? $session['id']), 3, '0', STR_PAD_LEFT);
        $dirs   = [];
        foreach (glob($base . '/' . $prefix . '*') ?: [] as $path) {
            if (is_dir($path)) {
                $dirs[] = $path;
            }
        }

        // Also include the canonical screenshots folder used by worker uploads.
        $shotDir = Services::reportService()->sessionScreenshotsDirectory($session, $run ?: null);
        if (is_dir($shotDir)) {
            $dirs[] = $shotDir;
        }
        $sessionDir = dirname($shotDir);
        if (is_dir($sessionDir)) {
            $dirs[] = $sessionDir;
        }

        return array_values(array_unique($dirs));
    }

    private function findEvidenceFile(array $session, string $filename): ?string
    {
        $events = [];
        try {
            $events = (new SessionEventsModel())
                ->where('session_id', (int) $session['id'])
                ->where('event_type', 'evidence')
                ->findAll();
        } catch (\Throwable $e) {
            $events = [];
        }

        foreach ($this->collectSessionImageFiles($session, $events) as $file) {
            if (basename($file) === $filename) {
                return $file;
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

        if (in_array($status, SessionsModel::ACTIVE, true)) {
            return [
                'state'  => 'in_progress',
                'label'  => $status === 'awaiting_decision'
                    ? 'AWAITING DECISION'
                    : ($isLogin ? 'LOGIN IN PROGRESS' : 'SESSION IN PROGRESS'),
                'detail' => $status === 'awaiting_decision'
                    ? 'Worker is paused safely until an Owner or QA Manager answers the pending decision.'
                    : ($isLogin
                        ? 'Worker is signing in using Jump To → Smart Books, then password. Complete any OTP challenge and wait for LOGIN SUCCESSFUL or LOGIN FAILED.'
                        : 'Worker is still executing this session.'),
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
                    : 'Login did not complete successfully. Check credentials, Jump To → Smart Books, OTP/challenge state, login URL, and screenshots.',
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
