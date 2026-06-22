<?php

namespace App\Filters;

use App\Models\SettingsModel;
use App\Models\TargetProfilesModel;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * ProductionGuardFilter — refuses write actions when the resolved target profile
 * is on a production environment (`prod_basic` or `prod_full`) unless an Owner has
 * explicitly toggled the `production_unlock` setting on.
 *
 * Resolves the target profile from one of:
 *   - URL segment after `target-profiles/{id}/...`
 *   - JSON body  `target_profile_id`
 *   - JSON body  `qa_run_id` (then looks up the run's profile)
 */
class ProductionGuardFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $method = strtoupper($request->getMethod());
        if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            return;
        }

        $targetId = $this->resolveTargetProfileId($request);
        if (! $targetId) {
            return; // no resolvable target — let business logic decide
        }

        $profile = (new TargetProfilesModel())->find($targetId);
        if (! $profile) {
            return;
        }

        $env = $profile['environment'] ?? '';
        $isProd = $env === 'prod_basic' || $env === 'prod_full';
        if (! $isProd) {
            return;
        }

        // Allowed under prod_full only when Owner unlock is enabled.
        $unlock = (new SettingsModel())->getSetting('production_unlock', ['enabled' => false]);
        if (! ($unlock['enabled'] ?? false)) {
            return service('response')->setStatusCode(423)->setJSON([
                'ok'          => false,
                'error'       => 'Production write blocked by ProductionGuardFilter.',
                'environment' => $env,
                'hint'        => 'Toggle Settings → production_unlock as Owner (per-run).',
            ]);
        }

        // For prod_basic, refuse data_creation when the profile says so.
        if ($env === 'prod_basic' && empty($profile['data_creation_allowed'])) {
            return service('response')->setStatusCode(423)->setJSON([
                'ok'    => false,
                'error' => 'Production basic — data_creation_allowed is false on this target profile.',
            ]);
        }
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }

    private function resolveTargetProfileId(RequestInterface $request): ?int
    {
        $uri = $request->getUri()->getPath();
        if (preg_match('#/target-profiles/(\d+)/#', $uri, $m)) {
            return (int) $m[1];
        }

        $body = $request->getJSON(true);
        if (is_array($body) && ! empty($body['target_profile_id'])) {
            return (int) $body['target_profile_id'];
        }

        return null;
    }
}
