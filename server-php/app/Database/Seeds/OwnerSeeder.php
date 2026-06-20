<?php

namespace App\Database\Seeds;

use CodeIgniter\CLI\CLI;
use CodeIgniter\Database\Seeder;

class OwnerSeeder extends Seeder
{
    public function run(): void
    {
        $email    = env('QA_OWNER_EMAIL') ?: 'owner@aicountly.org';
        $name     = env('QA_OWNER_NAME') ?: 'QA Owner';
        $password = env('QA_OWNER_PASSWORD') ?: $this->randomPassword();

        $existing = $this->db->table('qa_users')->where('email', $email)->get()->getRow();
        if ($existing) {
            CLI::write("Owner user already exists: {$email}", 'yellow');
            return;
        }

        $hash = password_hash($password, PASSWORD_BCRYPT);
        $now  = date('Y-m-d H:i:s');

        $this->db->table('qa_users')->insert([
            'email'         => $email,
            'name'          => $name,
            'password_hash' => $hash,
            'status'        => 'active',
            'created_at'    => $now,
            'updated_at'    => $now,
        ]);

        $userId = $this->db->insertID();

        $role = $this->db->table('qa_roles')->where('code', 'Owner')->get()->getRow();
        if ($role) {
            $linked = $this->db->table('qa_user_roles')
                ->where('user_id', $userId)
                ->where('role_id', $role->id)
                ->countAllResults() > 0;
            if (! $linked) {
                $this->db->table('qa_user_roles')->insert([
                    'user_id'    => $userId,
                    'role_id'    => $role->id,
                    'created_at' => $now,
                ]);
            }
        }

        CLI::write("Seeded Owner user.", 'green');
        CLI::write("  email:    {$email}", 'white');
        CLI::write("  password: {$password}", 'yellow');
        CLI::write("  Change this password on first login.", 'white');
    }

    private function randomPassword(): string
    {
        return bin2hex(random_bytes(8)); // 16 hex chars
    }
}
