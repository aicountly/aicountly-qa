<?php

namespace Tests\Database;

use App\Services\ConsoleAccess\ConsoleRoleSyncService;
use App\Services\ConsoleAccess\ConsoleUserAccessClient;
use App\Services\ConsoleAccess\DbUserRoleStore;
use App\Services\ConsoleIdentityService;
use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;
use CodeIgniter\Test\FeatureTestTrait;
use CodeIgniter\Test\TestResponse;
use Config\Services;
use Tests\Support\StubConsoleTransport;

/**
 * End-to-end over the real routes + PostgreSQL: Console SSO login, token
 * refresh and the per-request re-check apply Console-assigned roles.
 * Console itself is stubbed (identity service + user-access transport).
 *
 * @internal
 */
final class ConsoleSsoFeatureTest extends CIUnitTestCase
{
    use DatabaseTestTrait;
    use FeatureTestTrait;

    protected $DBGroup     = 'tests';
    protected $migrate     = true;
    protected $migrateOnce = true;
    protected $refresh     = false;
    protected $namespace   = 'App';

    /** @var array<string,mixed> */
    private array $identity = [];

    protected function setUp(): void
    {
        $config = config('Database')->tests;
        if (trim((string) ($config['database'] ?? '')) === '') {
            $this->markTestSkipped('Set database.tests.* to a scratch PostgreSQL database to run the database suite.');
        }

        parent::setUp();

        $this->db->query('TRUNCATE qa_user_roles, qa_users RESTART IDENTITY CASCADE');

        $test = $this;
        Services::injectMock('consoleIdentity', new class ($test) extends ConsoleIdentityService {
            public function __construct(private ConsoleSsoFeatureTest $test)
            {
            }

            public function exchangeLaunchToken(string $token): ?array
            {
                return $this->test->currentIdentity();
            }

            public function introspectSession(string $consoleToken): ?array
            {
                return $this->test->currentIdentity();
            }
        });
        $this->useConsole(null, false);
    }

    /** @return array<string,mixed> */
    public function currentIdentity(): array
    {
        return $this->identity;
    }

    private function useConsole(?StubConsoleTransport $transport, bool $configured = true): void
    {
        Services::injectMock('consoleRoleSync', new ConsoleRoleSyncService(
            new DbUserRoleStore($this->db),
            new ConsoleUserAccessClient('https://console.test/api', $configured ? 'product-key' : '', 'qa', $transport ?? StubConsoleTransport::down()),
        ));
    }

    /** @param array<string,mixed> $extra */
    private function login(array $extra): TestResponse
    {
        $this->identity = array_merge([
            'active'            => true,
            'global_superadmin' => false,
            'user'              => ['id' => 42, 'name' => 'Asha', 'email' => 'asha@example.com', 'role' => 'staff'],
            'controller_grants' => [],
            'app_code'          => 'qa',
        ], $extra);

        return $this->withBodyFormat('json')->post('v1/auth/controller-sso', ['token' => 'launch-token']);
    }

    /** @return array<string,mixed> */
    private static function json(TestResponse $r): array
    {
        return json_decode((string) $r->getJSON(), true) ?? [];
    }

    /** @return list<string> */
    private function localRoles(string $email = 'asha@example.com'): array
    {
        $rows = $this->db->query(
            'SELECT r.slug FROM qa_user_roles ur JOIN qa_roles r ON r.id = ur.role_id JOIN qa_users u ON u.id = ur.user_id WHERE u.email = ? ORDER BY r.id',
            [$email],
        )->getResultArray();

        return array_column($rows, 'slug');
    }

    public function testLoginWithAppRolesReplacesLocalRolesAndStoresConsoleLink(): void
    {
        $this->login(['app_roles' => ['owner'], 'app_superadmin' => false, 'console_user_id' => 42, 'authz_version' => 3])->assertStatus(200);
        $this->assertSame(['owner'], $this->localRoles());

        $r = $this->login(['app_roles' => ['qa_manager'], 'app_superadmin' => false, 'console_user_id' => 42, 'authz_version' => 4]);
        $r->assertStatus(200);
        $this->assertSame(['QA Manager'], self::json($r)['data']['user']['roles']);
        $this->assertSame(['qa_manager'], $this->localRoles());

        $user = $this->db->table('qa_users')->where('email', 'asha@example.com')->get()->getRowArray();
        $this->assertSame(42, (int) $user['console_user_id']);
        $this->assertSame(4, (int) $user['authz_version']);
        $this->assertNotNull($user['roles_synced_at']);
    }

    public function testLoginWithEmptyAppRolesIsRefused(): void
    {
        $this->login(['app_roles' => ['qa_manager']])->assertStatus(200);

        $r = $this->login(['app_roles' => [], 'app_superadmin' => false]);
        $r->assertStatus(403);
        $this->assertSame('Access not assigned. Ask a Console superadmin to assign you a role.', self::json($r)['error']);
        $this->assertSame([], $this->localRoles());
    }

    public function testFirstLoginWithEmptyAppRolesCreatesNoUser(): void
    {
        $this->login(['app_roles' => []])->assertStatus(403);
        $this->assertSame(0, $this->db->table('qa_users')->countAllResults());
    }

    public function testSuperadminGetsOwner(): void
    {
        $r = $this->login(['global_superadmin' => true, 'app_superadmin' => true, 'app_roles' => ['owner', 'qa_manager', 'developer_viewer', 'auditor_viewer']]);
        $r->assertStatus(200);
        $this->assertContains('Owner', self::json($r)['data']['user']['roles']);
        $this->assertSame(['owner', 'qa_manager', 'developer_viewer', 'auditor_viewer'], $this->localRoles());
    }

    public function testOldPayloadNeverGivesNonSuperadminTheTopRole(): void
    {
        $r = $this->login([]); // no app_roles key: old Console
        $r->assertStatus(200);
        $this->assertSame(['Developer Viewer'], self::json($r)['data']['user']['roles']);
        $this->assertNotContains('owner', $this->localRoles());
    }

    public function testSsoCallbackShowsTheNotAssignedMessage(): void
    {
        $this->identity = [
            'active' => true, 'global_superadmin' => false, 'app_roles' => [],
            'user'   => ['id' => 42, 'name' => 'Asha', 'email' => 'asha@example.com'],
        ];

        $r = $this->get('v1/auth/sso-callback?token=launch-token');
        $r->assertStatus(403);
        $r->assertSee('Access not assigned. Ask a Console superadmin to assign you a role.');
    }

    public function testRefreshWithRevokedConsoleAccessIsRefusedAndEndsSessions(): void
    {
        $token = self::json($this->login(['app_roles' => ['qa_manager'], 'console_user_id' => 42]))['data']['token'];

        $this->useConsole(StubConsoleTransport::ok(['exists' => true, 'active' => true, 'app_access' => false, 'app_roles' => []]));
        $this->withBodyFormat('json')->post('v1/auth/refresh', ['token' => $token])->assertStatus(403);
        $this->assertSame([], $this->localRoles());

        $this->useConsole(null, false);
        $this->withHeaders(['Authorization' => 'Bearer ' . $token])->get('v1/me')->assertStatus(401);
    }

    public function testRefreshReplacesRolesFromConsole(): void
    {
        $token = self::json($this->login(['app_roles' => ['qa_manager']]))['data']['token'];

        $this->useConsole(StubConsoleTransport::ok(['exists' => true, 'active' => true, 'app_access' => true, 'app_roles' => ['auditor_viewer'], 'authz_version' => 8]));
        $r = $this->withBodyFormat('json')->post('v1/auth/refresh', ['token' => $token]);
        $r->assertStatus(200);
        $this->assertSame(['Auditor Viewer'], self::json($r)['data']['roles']);
        $this->assertSame(['auditor_viewer'], $this->localRoles());
    }

    public function testRefreshWhileConsoleIsDownWithinAndAfter12Hours(): void
    {
        $token = self::json($this->login(['app_roles' => ['qa_manager']]))['data']['token'];
        $this->useConsole(StubConsoleTransport::down());

        $this->db->query("UPDATE qa_users SET roles_synced_at = CURRENT_TIMESTAMP - INTERVAL '11 hours'");
        $this->withBodyFormat('json')->post('v1/auth/refresh', ['token' => $token])->assertStatus(200);
        $this->assertSame(['qa_manager'], $this->localRoles());

        $this->db->query("UPDATE qa_users SET roles_synced_at = CURRENT_TIMESTAMP - INTERVAL '13 hours'");
        $r = $this->withBodyFormat('json')->post('v1/auth/refresh', ['token' => $token]);
        $r->assertStatus(401);
        $this->assertStringContainsString('more than 12 hours', self::json($r)['error']);
        $this->assertSame(['qa_manager'], $this->localRoles());
    }

    public function testAuthenticatedRequestRechecksConsoleOnceRolesAreStale(): void
    {
        $token = self::json($this->login(['app_roles' => ['qa_manager']]))['data']['token'];
        $this->db->query("UPDATE qa_users SET roles_synced_at = CURRENT_TIMESTAMP - INTERVAL '20 minutes'");

        $this->useConsole(StubConsoleTransport::ok(['exists' => true, 'active' => true, 'app_access' => true, 'app_roles' => ['developer_viewer']]));
        $r = $this->withHeaders(['Authorization' => 'Bearer ' . $token])->get('v1/me');
        $r->assertStatus(200);
        $this->assertSame(['Developer Viewer'], self::json($r)['data']['roles']);
    }

    public function testLocalRoleEditingIsReadOnly(): void
    {
        $token = self::json($this->login(['app_superadmin' => true, 'app_roles' => ['owner']]))['data']['token'];

        $r = $this->withHeaders(['Authorization' => 'Bearer ' . $token])
            ->withBodyFormat('json')
            ->put('v1/users/1', ['roles' => ['Developer Viewer']]);
        $r->assertStatus(403);
        $this->assertStringContainsString('Console → Roles & Access', self::json($r)['error']);

        $list = $this->withHeaders(['Authorization' => 'Bearer ' . $token])->get('v1/users');
        $list->assertStatus(200);
        $this->assertSame('console', self::json($list)['roles_managed_by']);
    }
}
