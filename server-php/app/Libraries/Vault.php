<?php

namespace App\Libraries;

use RuntimeException;

/**
 * Vault — AES-256-GCM symmetric encryption for target app credentials.
 *
 * The portal NEVER stores plaintext secrets. All credential plaintext lives only
 * in memory during a single request, encrypted with QA_VAULT_KEY before persisting.
 *
 * Key format: 64 hex chars (= 32 bytes). Generate with:
 *   php -r "echo bin2hex(random_bytes(32)).PHP_EOL;"
 */
class Vault
{
    private const CIPHER = 'aes-256-gcm';
    private const IV_LEN = 12;   // 96-bit GCM IV recommended
    private const TAG_LEN = 16;  // 128-bit auth tag

    private string $key;

    public function __construct(?string $hexKey = null)
    {
        $hexKey ??= (string) env('QA_VAULT_KEY', '');

        if ($hexKey === '' || ! ctype_xdigit($hexKey) || strlen($hexKey) !== 64) {
            throw new RuntimeException('QA_VAULT_KEY must be a 64-char hex string (32 bytes). Generate one and set it in .env.');
        }

        $this->key = hex2bin($hexKey);
    }

    /**
     * Encrypt plaintext. Returns [iv, ciphertext, tag] — all binary strings.
     *
     * @return array{iv: string, ciphertext: string, tag: string}
     */
    public function encrypt(string $plaintext): array
    {
        $iv = random_bytes(self::IV_LEN);
        $tag = '';

        $ciphertext = openssl_encrypt(
            $plaintext,
            self::CIPHER,
            $this->key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            self::TAG_LEN
        );

        if ($ciphertext === false) {
            throw new RuntimeException('Vault encryption failed.');
        }

        return ['iv' => $iv, 'ciphertext' => $ciphertext, 'tag' => $tag];
    }

    /**
     * Decrypt previously encrypted payload.
     */
    public function decrypt(string $iv, string $ciphertext, string $tag): string
    {
        $plaintext = openssl_decrypt(
            $ciphertext,
            self::CIPHER,
            $this->key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        if ($plaintext === false) {
            throw new RuntimeException('Vault decryption failed (possible tampering or wrong key).');
        }

        return $plaintext;
    }
}
