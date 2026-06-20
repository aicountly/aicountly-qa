<?php

namespace App\Models;

use CodeIgniter\Model;

class TestDataPacksModel extends Model
{
    protected $table         = 'qa_test_data_packs';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;

    protected $allowedFields = [
        'product_name', 'module', 'pack_name', 'description',
        'data_json', 'version', 'is_active', 'created_by',
    ];

    protected array $casts = [
        'data_json' => 'json-array',
        'is_active' => 'bool',
    ];

    public function activeForProduct(string $product): array
    {
        return $this->where('product_name', $product)
            ->where('is_active', true)
            ->orderBy('version', 'DESC')
            ->findAll();
    }
}
