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

        $lastEvent = $events !== [] ? $events[array_key_last($events)] : null;
        $activity  = is_array($lastEvent) ? (string) ($lastEvent['message'] ?? '') : '';
        if ($activity === '') {
            $activity = match ((string) ($session['status'] ?? '')) {
                'queued'  => 'Waiting in queue for the QA worker to claim this session.',
                'claimed' => 'Session claimed — worker is preparing to start.',
                'running' => 'Session is running. Waiting for the next worker progress update…',
                'completed', 'passed' => 'Session completed successfully.',
                'failed'  => 'Session failed.',
                'skipped' => 'Session was skipped.',
                default   => 'No live activity yet.',
            };
        }

        return $this->respond([
            'ok'   => true,
            'data' => [
                'session'           => $session,
                'activity'          => $activity,
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
     */
    public function evidence($id = null, $filename = null)
    {
        $sessionId = (int) $id;
        $filename  = basename((string) $filename);
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

        $mime = mime_content_type($path) ?: 'application/octet-stream';
        if (str_starts_with($mime, 'text/') || $mime === 'application/json') {
            $mime .= '; charset=UTF-8';
        }

        return $this->response
            ->setHeader('Content-Type', $mime)
            ->setHeader('Cache-Control', 'private, max-age=60')
            ->setBody((string) file_get_contents($path));
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

        foreach ($dirs as $dir) {
            foreach (glob($dir . '/*') ?: [] as $file) {
                if (! is_file($file)) {
                    continue;
                }
                $name = basename($file);
                $ext  = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                if (! in_array($ext, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true)) {
                    continue;
                }
                $out[] = [
                    'filename'   => $name,
                    'kind'       => 'screenshot',
                    'url'        => '/v1/sessions/' . (int) $session['id'] . '/evidence/' . rawurlencode($name),
                    'created_at' => date('Y-m-d H:i:s', (int) filemtime($file)),
                ];
            }
        }

        usort($out, static fn ($a, $b) => strcmp((string) $a['created_at'], (string) $b['created_at']));

        return $out;
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
            $candidate = $dir . DIRECTORY_SEPARATOR . $filename;
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }
}
