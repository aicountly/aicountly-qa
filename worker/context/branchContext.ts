import type { Page } from 'playwright'

export async function selectOrCreateBranch(page: Page, name: string): Promise<{ status: 'selected' | 'created' | 'skipped' }> {
  const picker = page.locator('[data-test=branch-picker], select[name=branch], input[role=combobox][aria-label*="branch" i]').first()
  if (await picker.count()) {
    if ((await picker.evaluate((el) => el.tagName)).toLowerCase() === 'select') {
      await picker.selectOption({ label: name }).catch(() => null)
    } else {
      await picker.click()
      await page.locator(`text="${name}"`).first().click({ timeout: 5_000 }).catch(() => null)
    }
    return { status: 'selected' }
  }

  const newBtn = page.locator('button:has-text("New Branch"), button:has-text("Create Branch"), [data-test=new-branch]').first()
  if (await newBtn.count()) {
    await newBtn.click()
    await page.locator('input[name=name], [data-test=branch-name]').first().fill(name).catch(() => null)
    await page.locator('button[type=submit], button:has-text("Save")').first().click().catch(() => null)
    return { status: 'created' }
  }

  return { status: 'skipped' }
}
