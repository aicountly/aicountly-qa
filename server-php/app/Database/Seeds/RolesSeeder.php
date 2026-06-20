<?php

namespace App\Database\Seeds;

use CodeIgniter\Database\Seeder;

class RolesSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            ['code' => 'Owner',           'name' => 'Owner',           'description' => 'Full control. Can manage users, target profiles, credentials, approve sessions, run tests, change settings, unlock production write mode.'],
            ['code' => 'QA Manager',      'name' => 'QA Manager',      'description' => 'Can manage target profiles, approve sessions and run QA tests. Cannot change global settings or unlock production write mode.'],
            ['code' => 'Developer Viewer','name' => 'Developer Viewer','description' => 'Read-only access to QA reports, error register and validation results. No write access.'],
            ['code' => 'Auditor Viewer',  'name' => 'Auditor Viewer',  'description' => 'Read-only access to selected final reports and audit logs only.'],
        ];

        $now = date('Y-m-d H:i:s');
        foreach ($rows as $row) {
            $exists = $this->db->table('qa_roles')->where('code', $row['code'])->countAllResults() > 0;
            if ($exists) {
                continue;
            }
            $row['created_at'] = $now;
            $row['updated_at'] = $now;
            $this->db->table('qa_roles')->insert($row);
        }
    }
}
