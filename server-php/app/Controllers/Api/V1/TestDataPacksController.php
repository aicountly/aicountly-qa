<?php

namespace App\Controllers\Api\V1;

use App\Models\ExpectedResultsModel;
use App\Models\TestDataPacksModel;
use CodeIgniter\RESTful\ResourceController;

class TestDataPacksController extends ResourceController
{
    protected $modelName = TestDataPacksModel::class;
    protected $format    = 'json';

    public function index()
    {
        $product = $this->request->getGet('product');
        if ($product) {
            $this->model->where('product_name', $product);
        }
        return $this->respond(['ok' => true, 'data' => $this->model->orderBy('product_name')->orderBy('version', 'DESC')->findAll()]);
    }

    public function show($id = null)
    {
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $row['expected'] = (new ExpectedResultsModel())->forPack((int) $id);
        return $this->respond(['ok' => true, 'data' => $row]);
    }
}
