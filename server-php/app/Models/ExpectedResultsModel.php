<?php

namespace App\Models;

use CodeIgniter\Model;

class ExpectedResultsModel extends Model
{
    protected $table         = 'qa_expected_results';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'pack_id', 'metric_key', 'metric_label', 'expected_value_json', 'tolerance', 'created_at',
    ];

    protected array $casts = [
        'expected_value_json' => 'json-array',
    ];

    public function forPack(int $packId): array
    {
        return $this->where('pack_id', $packId)->findAll();
    }
}
