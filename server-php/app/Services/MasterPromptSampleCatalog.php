<?php

namespace App\Services;

/**
 * Loads master prompt samples from samples/prompts/ (deployed alongside the API).
 *
 * Falls back to the legacy per-product `_sample_prompts.json` files under
 * app/Database/Templates/{product}/ so an older deploy without the samples
 * directory still returns something usable.
 */
class MasterPromptSampleCatalog
{
    /** @var list<array{id:string,label:string,description:string,product?:string,prompt:string}>|null */
    private ?array $cache = null;

    /**
     * @return list<array{id:string,label:string,description:string,product?:string,prompt:string}>
     */
    public function all(): array
    {
        if ($this->cache !== null) {
            return $this->cache;
        }

        $dir = $this->promptsDir();
        if ($dir === null) {
            return $this->cache = $this->legacyFromTemplates();
        }

        $manifestPath = $dir . DIRECTORY_SEPARATOR . 'manifest.json';
        if (! is_file($manifestPath)) {
            return $this->cache = $this->legacyFromTxtFiles($dir);
        }

        $manifest = json_decode((string) file_get_contents($manifestPath), true);
        if (! is_array($manifest) || ! is_array($manifest['samples'] ?? null)) {
            return $this->cache = $this->legacyFromTemplates();
        }

        $out = [];
        foreach ($manifest['samples'] as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $id   = trim((string) ($entry['id'] ?? ''));
            $file = basename(trim((string) ($entry['file'] ?? '')));
            if ($id === '' || $file === '') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $file;
            if (! is_file($path)) {
                continue;
            }

            $row = [
                'id'          => $id,
                'label'       => trim((string) ($entry['label'] ?? $id)),
                'description' => trim((string) ($entry['description'] ?? '')),
                'prompt'      => trim((string) file_get_contents($path)),
            ];
            $product = trim((string) ($entry['product'] ?? ''));
            if ($product !== '') {
                $row['product'] = $product;
            }
            $out[] = $row;
        }

        return $this->cache = ($out !== [] ? $out : $this->legacyFromTemplates());
    }

    /**
     * Product matches land in `recommended`; everything else in `other`.
     *
     * @return array{recommended:list<array<string,mixed>>,other:list<array<string,mixed>>}
     */
    public function forProduct(?string $productName): array
    {
        $all  = $this->all();
        $slug = strtolower(trim((string) $productName));

        if ($slug === '') {
            return ['recommended' => [], 'other' => $all];
        }

        $recommended = [];
        $other       = [];
        foreach ($all as $sample) {
            if (strtolower((string) ($sample['product'] ?? '')) === $slug) {
                $recommended[] = $sample;
            } else {
                $other[] = $sample;
            }
        }

        return ['recommended' => $recommended, 'other' => $other];
    }

    private function promptsDir(): ?string
    {
        $candidates = [
            trim((string) env('QA_PROMPT_SAMPLES_DIR', '')),
            // server-php/app/../../samples/prompts → repo root
            APPPATH . '..' . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'samples' . DIRECTORY_SEPARATOR . 'prompts',
            // Deployed layout: api/ next to samples/
            APPPATH . '..' . DIRECTORY_SEPARATOR . 'samples' . DIRECTORY_SEPARATOR . 'prompts',
            WRITEPATH . '..' . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'samples' . DIRECTORY_SEPARATOR . 'prompts',
        ];

        foreach ($candidates as $candidate) {
            if ($candidate === '') {
                continue;
            }
            $resolved = realpath($candidate);
            if ($resolved !== false && is_dir($resolved)) {
                return $resolved;
            }
        }

        return null;
    }

    /**
     * Fallback when manifest.json is missing — one sample per *.txt.
     *
     * @return list<array<string, mixed>>
     */
    private function legacyFromTxtFiles(string $dir): array
    {
        $out = [];
        foreach (glob($dir . DIRECTORY_SEPARATOR . '*.txt') ?: [] as $path) {
            $base   = basename($path, '.txt');
            $prompt = trim((string) file_get_contents($path));
            if ($prompt === '') {
                continue;
            }
            $row = [
                'id'          => $base,
                'label'       => ucfirst(str_replace('-', ' ', $base)),
                'description' => '',
                'prompt'      => $prompt,
            ];
            if (! str_starts_with($base, 'generic-')) {
                $row['product'] = explode('-', $base)[0];
            }
            $out[] = $row;
        }

        return $out;
    }

    /**
     * Last resort: the per-product `_sample_prompts.json` shipped with the
     * session templates. Pre-dates the samples/ directory.
     *
     * @return list<array<string, mixed>>
     */
    private function legacyFromTemplates(): array
    {
        $out  = [];
        $root = APPPATH . 'Database' . DIRECTORY_SEPARATOR . 'Templates';
        foreach (glob($root . DIRECTORY_SEPARATOR . '*' . DIRECTORY_SEPARATOR . '_sample_prompts.json') ?: [] as $path) {
            $product = basename(dirname($path));
            $decoded = json_decode((string) file_get_contents($path), true);
            foreach ((array) ($decoded['samples'] ?? []) as $i => $sample) {
                if (! is_array($sample) || trim((string) ($sample['prompt'] ?? '')) === '') {
                    continue;
                }
                $out[] = [
                    'id'          => $product . '-legacy-' . $i,
                    'label'       => trim((string) ($sample['name'] ?? ('Sample ' . ($i + 1)))),
                    'description' => '',
                    'product'     => $product,
                    'prompt'      => trim((string) $sample['prompt']),
                ];
            }
        }

        return $out;
    }
}
