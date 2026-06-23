<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\ErrorRegisterModel;
use App\Models\ReportsModel;
use App\Models\RunsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use Config\Services;

class DashboardController extends BaseApiController
{
    public function summary()
    {
        $runs     = new RunsModel();
        $sessions = new SessionsModel();
        $results  = new SessionResultsModel();
        $errors   = new ErrorRegisterModel();
        $reports  = new ReportsModel();

        $totalRuns    = $runs->countAllResults();
        $passed       = $results->where('status', 'passed')->countAllResults(false);
        $results->resetQuery();
        $failed       = $results->where('status', 'failed')->countAllResults(false);
        $results->resetQuery();

        $critical = $errors->where('severity', 'critical')->where('status', 'open')->countAllResults();
        $high     = $errors->where('severity', 'high')->where('status', 'open')->countAllResults();

        $lastRun = $runs->orderBy('created_at', 'DESC')->first();

        // Module-wise failures (top 6).
        $db = $sessions->db;
        $moduleFailures = $db->query(
            "SELECT module, COUNT(*) AS failed
             FROM qa_session_results sr
             JOIN qa_sessions s ON s.id = sr.session_id
             WHERE sr.status = 'failed'
             GROUP BY module
             ORDER BY failed DESC
             LIMIT 6"
        )->getResultArray();

        $recentReports = $reports->orderBy('generated_at', 'DESC')->limit(8)->findAll();

        $targetHealth = $db->query(
            "SELECT tp.id, tp.profile_name, tp.product_name, tp.environment, r.status, r.completed_at
             FROM qa_target_profiles tp
             LEFT JOIN LATERAL (
               SELECT status, completed_at FROM qa_runs WHERE target_profile_id = tp.id ORDER BY created_at DESC LIMIT 1
             ) r ON TRUE
             ORDER BY tp.product_name, tp.profile_name
             LIMIT 20"
        )->getResultArray();

        return $this->ok([
            'cards' => [
                'total_runs'      => $totalRuns,
                'passed_sessions' => $passed,
                'failed_sessions' => $failed,
                'critical_issues' => $critical,
                'high_issues'     => $high,
                'last_run'        => $lastRun,
            ],
            'module_failures' => $moduleFailures,
            'target_health'   => $targetHealth,
            'recent_reports'  => $recentReports,
            'worker'          => Services::workerStatus()->status(),
        ]);
    }

    public function workerStatus()
    {
        return $this->ok(Services::workerStatus()->status());
    }
}
