<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\ValidationResultsModel;

class ValidationController extends BaseApiController
{
    public function index()
    {
        $q = $this->request->getGet();
        $m = new ValidationResultsModel();
        if (! empty($q['qa_run_id']))  { $m->where('qa_run_id', $q['qa_run_id']); }
        if (! empty($q['session_id'])) { $m->where('session_id', $q['session_id']); }
        if (! empty($q['rule_code']))  { $m->where('rule_code', $q['rule_code']); }
        if (isset($q['passed']))       { $m->where('passed', $q['passed'] === 'true' || $q['passed'] === '1'); }

        return $this->ok($m->orderBy('id', 'DESC')->limit(500)->findAll());
    }
}
