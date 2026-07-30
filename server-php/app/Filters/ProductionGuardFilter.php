<?php

namespace App\Filters;

use App\Models\SettingsModel;
use App\Models\TargetProfilesModel;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use Config\Environments;

/**
 * ProductionGuardFilter — refuses write actions when the resolved target profile
 * points at a live environment, unless an Owner has explicitly toggled the
 * `production_unlock` setting on.
 *
 * Tiers are checked through Config\Environments capability flags, never through
 * a `str_starts_with($env, 'production')` test: production_full_access is a live
 * target that deliberately opts out of the observer-only rules.
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

        $env = Environments::normalize((string) ($profile['environment'] ?? ''));
        if (! Environments::isProduction($env)) {
            return;
        }

        $unlock = (new SettingsModel())->getSetting('production_unlock', ['enabled' => false]);
        if (! ($unlock['enabled'] ?? false)) {
            return service('response')->setStatusCode(423)->setJSON([
                'ok'            => false,
                'error'         => 'Production write blocked by ProductionGuardFilter.',
                'environment'   => $env,
                'environment_label' => Environments::label($env),
                'observer_only' => Environments::isObserverOnly($env),
                'hint'          => 'Toggle Settings → production_unlock as Owner (per-run).',
            ]);
        }

        // Observer-only tiers stay read-only even with the unlock toggled on.
        if (Environments::isObserverOnly($env)) {
            return service('response')->setStatusCode(423)->setJSON([
                'ok'            => false,
                'error'         => 'This environment is observer-only: reads and screenshots only, no writes.',
                'environment'   => $env,
                'environment_label' => Environments::label($env),
                'observer_only' => true,
            ]);
        }

        if (empty($profile['data_creation_allowed'])) {
            return service('response')->setStatusCode(423)->setJSON([
                'ok'    => false,
                'error' => 'data_creation_allowed is false on this target profile.',
                'environment' => $env,
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
