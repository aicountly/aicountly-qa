<?php

namespace App\Services;

use App\Models\AuditLogsModel;

/**
 * Append-only audit log writer. Used by controllers and the worker endpoints.
 */
class AuditService
{
    private AuditLogsModel $model;

    public function __construct()
    {
        $this->model = new AuditLogsModel();
    }

    public function log(string $event, array $opts = []): void
    {
        $req = service('request');
        $row = [
            'event'        => $event,
            'actor_id'     => $opts['actor_id']     ?? ($req->qaUser['id']    ?? null),
            'actor_email'  => $opts['actor_email']  ?? ($req->qaUser['email'] ?? null),
            'actor_role'   => $opts['actor_role']   ?? (($req->qaUser['roles'][0] ?? null)),
            'qa_run_id'    => $opts['qa_run_id']    ?? null,
            'session_id'   => $opts['session_id']   ?? null,
            'subject_kind' => $opts['subject_kind'] ?? null,
            'subject_id'   => isset($opts['subject_id']) ? (string) $opts['subject_id'] : null,
            'ip_address'   => $req->getIPAddress(),
            'user_agent'   => substr((string) $req->getUserAgent(), 0, 510),
            'metadata'     => isset($opts['metadata']) ? json_encode($opts['metadata']) : null,
            'created_at'   => date('Y-m-d H:i:s'),
        ];

        $this->model->insert($row);
    }
}
