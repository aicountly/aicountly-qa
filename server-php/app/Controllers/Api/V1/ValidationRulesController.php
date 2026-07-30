<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseResourceApiController;
use App\Models\ValidationRulesModel;

class ValidationRulesController extends BaseResourceApiController
{
    protected $modelName = ValidationRulesModel::class;
    protected $format    = 'json';

    public function index()
    {
        $product = $this->request->getGet('product');
        $rows = $product
            ? $this->model->activeForProduct($product)
            : $this->model->orderBy('rule_kind')->orderBy('rule_code')->findAll();
        return $this->respond(['ok' => true, 'data' => $rows]);
    }
}
