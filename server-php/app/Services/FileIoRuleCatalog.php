<?php

namespace App\Services;

/**
 * Product-agnostic validation rules raised by the file I/O engine.
 *
 * These sit next to the product-scoped FILE_* rules in ValidationRulesSeeder.
 * A file I/O scenario failure maps onto exactly one of these codes so the
 * Error Register shows a clear expected/actual pair instead of a generic
 * "file io failed" line.
 */
class FileIoRuleCatalog
{
    public const TRANSFER      = 'FILE_IO_TRANSFER_OK';
    public const MIME          = 'FILE_IO_MIME_EXPECTED';
    public const STRUCTURE     = 'FILE_IO_STRUCTURE_MATCH';
    public const ROWS          = 'FILE_IO_ROW_COUNT_MATCH';
    public const VALUES        = 'FILE_IO_KEY_VALUES_MATCH';
    public const TOTALS        = 'FILE_IO_NUMERIC_TOTALS_MATCH';
    public const OBSERVER      = 'FILE_IO_OBSERVER_UPLOAD_BLOCKED';

    /** @var array<string, array{title:string,severity:string,description:string}> */
    private const DEFINITIONS = [
        self::TRANSFER => [
            'title'       => 'File upload/download completes',
            'severity'    => 'high',
            'description' => 'The synthetic fixture uploads (or the export downloads) without an error, timeout, or silent no-op.',
        ],
        self::MIME => [
            'title'       => 'Transferred file has the expected MIME type',
            'severity'    => 'high',
            'description' => 'The produced artifact matches one of the MIME types declared for the scenario.',
        ],
        self::STRUCTURE => [
            'title'       => 'File structure survives the round trip',
            'severity'    => 'high',
            'description' => 'Headers, column count, and container signature match between the source fixture and the result artifact.',
        ],
        self::ROWS => [
            'title'       => 'Row count matches the fixture',
            'severity'    => 'critical',
            'description' => 'The number of data rows in the exported artifact equals the number of rows uploaded.',
        ],
        self::VALUES => [
            'title'       => 'Key column values round-trip unchanged',
            'severity'    => 'critical',
            'description' => 'Every key column value in the fixture is present and unmodified in the exported artifact.',
        ],
        self::TOTALS => [
            'title'       => 'Numeric totals match within tolerance',
            'severity'    => 'critical',
            'description' => 'Summed numeric columns match the fixture totals within the scenario tolerance.',
        ],
        self::OBSERVER => [
            'title'       => 'Observer-only environments never upload',
            'severity'    => 'critical',
            'description' => 'On production_readonly and production_restricted the worker asserts the upload is blocked instead of attempting it.',
        ],
    ];

    /** @return list<string> */
    public static function codes(): array
    {
        return array_keys(self::DEFINITIONS);
    }

    public static function severityFor(string $code): string
    {
        return self::DEFINITIONS[$code]['severity'] ?? 'high';
    }

    public static function titleFor(string $code): string
    {
        return self::DEFINITIONS[$code]['title'] ?? $code;
    }

    /**
     * Seeder/migration rows for qa_validation_rules.
     *
     * @return list<array<string, mixed>>
     */
    public static function rules(): array
    {
        $out = [];
        foreach (self::DEFINITIONS as $code => $definition) {
            $out[] = [
                'rule_code'        => $code,
                'rule_kind'        => 'file_io',
                'product_name'     => null,
                'title'            => $definition['title'],
                'severity_on_fail' => $definition['severity'],
                'description'      => $definition['description'],
                'expression_json'  => json_encode(['kind' => strtolower($code)]),
            ];
        }

        return $out;
    }
}
