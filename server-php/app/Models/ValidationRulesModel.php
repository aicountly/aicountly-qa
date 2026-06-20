<?php

namespace App\Models;

use CodeIgniter\Model;

class ValidationRulesModel extends Model
{
    protected $table         = 'qa_validation_rules';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;

    protected $allowedFields = [
        'rule_code', 'rule_kind', 'product_name', 'title', 'description',
        'expression_json', 'severity_on_fail', 'is_active',
    ];

    protected $casts = [
        'expression_json' => 'json-array',
        'is_active'       => 'bool',
    ];

    public function activeForProduct(?string $product): array
    {
        $b = $this->where('is_active', true);
        if ($product !== null) {
            $b->groupStart()
                ->where('product_name', $product)
                ->orWhere('product_name', null)
              ->groupEnd();
        }
        return $b->findAll();
    }
}
