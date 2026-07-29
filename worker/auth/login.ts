import type { Locator, Page } from 'playwright'
import { fetchCredentials } from '../apiClient.js'
import type { RuntimeContract, TargetProfile } from '../types.js'
import { buildJumpPlan, pickJumpTarget, type JumpOption } from './jumpTargets.js'
import { evaluateHostGuard } from '../utils/hostGuard.js'

export type LoginResult = {
  selectedJumpTo?: { label: string; value: string; matchedPreference: string | null }
  landedUrl: string
}

/**
 * Multi-step AICOUNTLY login:
 *   1) Identity + product-scoped Jump To → SIGN IN
 *   2) Password → CONTINUE / SIGN IN
 *   3) Optional OTP wall (surfaces as error / decision situation)
 */
export async function loginToTarget(
  page: Page,
  profile: TargetProfile,
  runtimeContract?: RuntimeContract | null,
): Promise<LoginResult> {
  const creds = await fetchCredentials(profile.id)
  if (!profile.username?.trim()) {
    throw new Error(`Target profile ${profile.id} has an empty username/email.`)
  }

  await page.goto(profile.login_url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await sleep(400)

  const selectedJumpTo = await aicountlyLogin(page, profile, creds.password, runtimeContract)
  await assertLoggedIn(page)
  await enforceProductHost(page, profile, runtimeContract, selectedJumpTo)

  return { selectedJumpTo, landedUrl: page.url() }
}

async function aicountlyLogin(
  page: Page,
  profile: TargetProfile,
  password: string,
  runtimeContract?: RuntimeContract | null,
): Promise<LoginResult['selectedJumpTo']> {
  const identity = await findIdentityField(page)
  if (!identity) throw new Error('Login form: could not find Email/Username field on step 1.')
  await fillReactInput(identity, profile.username.trim())

  const selectedJumpTo = await selectJumpTo(page, profile, runtimeContract)

  const step1Btn = page
    .locator('button[type="submit"], button:has-text("SIGN IN"), button:has-text("Sign In"), button:has-text("CONTINUE")')
    .filter({ hasNotText: /google|otp|phone/i })
    .first()
  if (!(await step1Btn.isVisible().catch(() => false))) {
    throw new Error('Login form: SIGN IN button not found on step 1.')
  }
  await step1Btn.click()

  const pass = page.locator('input[type="password"]:visible').first()
  try {
    await pass.waitFor({ state: 'visible', timeout: 30_000 })
  } catch {
    await throwIfOtpOrError(page, 'Password step did not appear after submitting identity + Jump To. ')
    throw new Error(
      'Password step did not appear after submitting email/username. '
      + 'Usually Jump To was not selected, or the account hit OTP/2FA.',
    )
  }

  await fillReactInput(pass, password)

  const step2Btn = page
    .locator('button[type="submit"], button:has-text("CONTINUE"), button:has-text("SIGN IN"), button:has-text("Sign In"), button:has-text("Log in")')
    .filter({ hasNotText: /google|different way|customer care/i })
    .first()
  if (await step2Btn.isVisible().catch(() => false)) {
    await step2Btn.click()
  } else {
    await page.keyboard.press('Enter')
  }

  await Promise.race([
    page.waitForURL((url) => !isLoginUrl(url.href), { timeout: 30_000 }),
    page.waitForSelector(
      'nav, aside, [role="navigation"], .sidebar, [class*="sidebar" i], [class*="dashboard" i]',
      { timeout: 30_000 },
    ),
    page.waitForSelector('input[placeholder*="Verification" i], input[name*="otp" i], text=/6 digit code/i', {
      timeout: 30_000,
    }),
  ]).catch(() => {})

  await sleep(600)
  await throwIfOtpOrError(page)
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
  return selectedJumpTo
}

async function selectJumpTo(
  page: Page,
  profile: TargetProfile,
  runtimeContract?: RuntimeContract | null,
): Promise<LoginResult['selectedJumpTo']> {
  const selectors = runtimeContract?.login?.jump_to_selectors?.length
    ? runtimeContract.login.jump_to_selectors
    : ['select#jumptoe', 'select[name=jumptoe]']

  let select: Locator | null = null
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if (await loc.count().catch(() => 0)) {
      select = loc
      break
    }
  }
  if (!select) {
    if (/aicountly\.com/i.test(page.url())) {
      throw new Error('Login form: Jump To dropdown (#jumptoe) not found.')
    }
    return undefined
  }

  const options: JumpOption[] = await select.locator('option').evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      label: ((el as HTMLOptionElement).textContent || '').trim(),
    })),
  )

  const candidates = runtimeContract?.login?.jump_to_candidates ?? []
  const plan = buildJumpPlan(profile.product_name || '', candidates)
  for (const warning of plan.warnings) {
    console.warn(`[aicountly-qa-worker] Jump To: ${warning}`)
  }

  const pick = pickJumpTarget(options, plan)
  if (!pick) throw new Error('Login form: Jump To dropdown has no selectable products.')

  console.log(
    `[aicountly-qa-worker] Jump To: product="${plan.product}" → "${pick.option.label}" `
    + `(value="${pick.option.value}", match=${pick.source}`
    + `${pick.matchedPreference ? `:${pick.matchedPreference}` : ''})`,
  )

  await select.selectOption({ value: pick.option.value }).catch(async () => {
    await select!.selectOption({ label: pick.option.label })
  })

  return {
    label: pick.option.label,
    value: pick.option.value,
    matchedPreference: pick.matchedPreference,
  }
}

async function enforceProductHost(
  page: Page,
  profile: TargetProfile,
  runtimeContract?: RuntimeContract | null,
  selectedJumpTo?: LoginResult['selectedJumpTo'],
): Promise<void> {
  const guard = runtimeContract?.post_login_host_guard
  const baseUrl = guard?.expected_base_url || profile.base_url
  const allowed = guard?.allowed_domains ?? profile.allowed_domains
  const recoverOnce = (guard?.recovery ?? 'navigate_base_url_once_then_fail') === 'navigate_base_url_once_then_fail'
    || guard?.recovery === undefined

  let result = evaluateHostGuard({ currentUrl: page.url(), baseUrl, allowedDomains: allowed })
  if (result.ok) return

  if (recoverOnce && baseUrl) {
    console.warn(`[aicountly-qa-worker] Host mismatch — navigating once to ${baseUrl}`)
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
    await sleep(500)
    result = evaluateHostGuard({ currentUrl: page.url(), baseUrl, allowedDomains: allowed })
    if (result.ok) return
  }

  const detail = [
    result.message || 'AUTH_PRODUCT_HOST_MATCH failed',
    `expected_host=${result.expectedHost}`,
    `actual_host=${result.actualHost}`,
    `landed_url=${page.url()}`,
    selectedJumpTo
      ? `jump_to="${selectedJumpTo.label}" (value=${selectedJumpTo.value}, matched=${selectedJumpTo.matchedPreference ?? 'n/a'})`
      : 'jump_to=(none)',
  ].join(' | ')
  const err = new Error(detail) as Error & { ruleCode?: string }
  err.ruleCode = guard?.validation_rule || 'AUTH_PRODUCT_HOST_MATCH'
  throw err
}

async function assertLoggedIn(page: Page): Promise<void> {
  if (!isLoginUrl(page.url())) return
  const visible = await collectLoginErrors(page)
  if (/otp|verification|2fa|challenge|6 digit/i.test(visible)) {
    const err = new Error(`Login OTP/challenge wall: ${visible.slice(0, 400)}`) as Error & { situation?: string }
    err.situation = 'login_otp_or_challenge'
    throw err
  }
  throw new Error(
    `Login remained on /login. Visible errors: ${visible.slice(0, 400) || '(none)'}`,
  )
}

async function throwIfOtpOrError(page: Page, prefix = ''): Promise<void> {
  const text = await collectLoginErrors(page)
  if (!text) return
  if (/otp|verification|2fa|challenge|6 digit/i.test(text)) {
    const err = new Error(`${prefix}Login OTP/challenge: ${text.slice(0, 400)}`) as Error & { situation?: string }
    err.situation = 'login_otp_or_challenge'
    throw err
  }
  if (/jump to|credential|password|invalid|incorrect|error!/i.test(text)) {
    throw new Error(`${prefix}${text.slice(0, 400)}`)
  }
}

async function collectLoginErrors(page: Page): Promise<string> {
  const chunks: string[] = []
  for (const sel of ['[role=alert]', '.alert-danger', '.error', '.invalid-feedback', '[class*=error]']) {
    const texts = await page.locator(sel).allInnerTexts().catch(() => [])
    chunks.push(...texts)
  }
  const body = await page.locator('body').innerText().catch(() => '')
  const lines = body.split(/\n+/).map((l) => l.trim()).filter((l) =>
    /jump to|credential|password|invalid|incorrect|otp|verification|challenge|error!/i.test(l),
  )
  chunks.push(...lines)
  return chunks.join(' | ').replace(/\s+/g, ' ').trim()
}

function isLoginUrl(url: string): boolean {
  try {
    return /\/login\b/i.test(new URL(url).pathname)
  } catch {
    return /\/login\b/i.test(url)
  }
}

async function findIdentityField(page: Page): Promise<Locator | null> {
  for (const sel of [
    'input[name=email]', 'input[name=username]', 'input[type=email]',
    '#email', '#username', '[data-test=email]',
  ]) {
    const loc = page.locator(`${sel}:visible`).first()
    if (await loc.count().catch(() => 0)) return loc
  }
  return null
}

async function fillReactInput(locator: Locator, value: string): Promise<void> {
  await locator.click({ clickCount: 3 }).catch(() => {})
  await locator.fill('')
  await locator.fill(value)
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement
    input.value = v
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value).catch(() => {})
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
