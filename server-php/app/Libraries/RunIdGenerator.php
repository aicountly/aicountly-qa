<?php

namespace App\Libraries;

use Config\Database;

/**
 * Generates daily-rolling QA run IDs: QA-RUN-YYYYMMDD-NNNN
 *
 * Uses the qa_run_sequence table with row-level locking so concurrent calls
 * never produce duplicate run IDs.
 */
class RunIdGenerator
{
    public function next(): string
    {
        $db = Database::connect();
        $dayKey = gmdate('Ymd');

        $db->transStart();

        // PostgreSQL upsert with SELECT FOR UPDATE on the row.
        $sql = 'INSERT INTO qa_run_sequence (day_key, last_seq, updated_at)
                VALUES (?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT (day_key) DO UPDATE
                SET last_seq = qa_run_sequence.last_seq + 1,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING last_seq;';

        $result = $db->query($sql, [$dayKey]);
        $row    = $result ? $result->getRow() : null;
        $seq    = $row?->last_seq ?? 1;

        $db->transComplete();

        return sprintf('QA-RUN-%s-%04d', $dayKey, $seq);
    }
}
