<?php

namespace App\Services\Brain\Adapters;

use CodeIgniter\HTTP\CURLRequest;
use RuntimeException;
use Throwable;

/**
 * Shared HTTP + JSON-extraction plumbing for brain adapters.
 *
 * Uses CodeIgniter's built-in CURLRequest rather than Guzzle: this codebase does
 * not depend on guzzlehttp/guzzle, and CURLRequest already covers the JSON POST
 * + configurable timeout needs of the provider adapters below.
 */
abstract class AbstractAdapter implements BrainAdapterInterface
{
    protected function client(array $options = []): CURLRequest
    {
        $defaults = [
            'http_errors' => false,
            'timeout'     => (int) env('BRAIN_TIMEOUT_SECONDS', 60),
        ];

        return \Config\Services::curlrequest(array_merge($defaults, $options), null, null, false);
    }

    /**
     * Try to extract a JSON object/array from the model's textual reply. Models
     * sometimes wrap JSON in markdown fences -- we handle that, plus stray prose
     * before/after a top-level {}/[] block.
     *
     * @return mixed
     */
    protected function extractJson(string $raw)
    {
        $text = trim($raw);
        if ($text === '') {
            return null;
        }
        // strip ```json ... ``` fences
        $text = (string) preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $text);
        // First attempt: parse as-is
        $j = json_decode($text, true);
        if ($j !== null) {
            return $j;
        }
        // Second: locate first balanced JSON object/array
        $first = null;
        foreach (['{', '['] as $open) {
            $i = strpos($text, $open);
            if ($i !== false && ($first === null || $i < $first[0])) {
                $first = [$i, $open];
            }
        }
        if ($first === null) {
            return null;
        }
        $close = $first[1] === '{' ? '}' : ']';
        $last = strrpos($text, $close);
        if ($last === false || $last < $first[0]) {
            return null;
        }
        $candidate = substr($text, $first[0], $last - $first[0] + 1);
        $j = json_decode($candidate, true);
        return $j === null ? null : $j;
    }

    /**
     * @param array<string,string> $headers
     * @param array<string,mixed>  $body
     * @return array<string,mixed>
     *
     * @throws RuntimeException
     */
    protected function postJson(string $url, array $headers, array $body, ?int $timeout = null): array
    {
        $options = [];
        if ($timeout !== null && $timeout > 0) {
            $options['timeout'] = $timeout;
            $options['connect_timeout'] = min(10, $timeout);
        }

        try {
            $started = microtime(true);
            $res = $this->client($options)->post($url, [
                'headers' => $headers,
                'json'    => $body,
            ]);
            $latency = (int) ((microtime(true) - $started) * 1000);
            $code = $res->getStatusCode();
            $payload = (string) $res->getBody();
            if ($code < 200 || $code >= 300) {
                throw new RuntimeException(static::class . " HTTP {$code}: " . substr($payload, 0, 500));
            }
            $decoded = json_decode($payload, true);
            if (! is_array($decoded)) {
                throw new RuntimeException(static::class . ' non-JSON response');
            }
            $decoded['__latency_ms'] = $latency;
            return $decoded;
        } catch (RuntimeException $e) {
            throw $e;
        } catch (Throwable $e) {
            throw new RuntimeException(static::class . ' transport error: ' . $e->getMessage(), 0, $e);
        }
    }
}
