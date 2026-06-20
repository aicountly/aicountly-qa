<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\AuditLogsModel;

class AuditLogsController extends BaseApiController
{
    public function index()
    {
        $q = $this->request->getGet();
        $m = new AuditLogsModel();
        if (! empty($q['event']))     { $m->where('event', $q['event']); }
        if (! empty($q['qa_run_id'])) { $m->where('qa_run_id', $q['qa_run_id']); }
        if (! empty($q['actor_id']))  { $m->where('actor_id', $q['actor_id']); }
        if (! empty($q['from']))      { $m->where('created_at >=', $q['from']); }
        if (! empty($q['to']))        { $m->where('created_at <=', $q['to']); }

        $rows = $m->orderBy('id', 'DESC')->limit(500)->findAll();
        return $this->ok($rows);
    }
}
