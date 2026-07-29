import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateHostGuard } from './hostGuard.js'

describe('hostGuard', () => {
  it('matches expected host', () => {
    const r = evaluateHostGuard({
      currentUrl: 'https://books.aicountly.com/app',
      baseUrl: 'https://books.aicountly.com',
    })
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'match')
  })

  it('fails on wrong product host', () => {
    const r = evaluateHostGuard({
      currentUrl: 'https://books.aicountly.com/app',
      baseUrl: 'https://hrms.aicountly.com',
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'mismatch')
  })

  it('allows wildcard domains', () => {
    const r = evaluateHostGuard({
      currentUrl: 'https://tenant.hrms.aicountly.com/x',
      baseUrl: 'https://hrms.aicountly.com',
      allowedDomains: ['*.aicountly.com'],
    })
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'allowlisted')
  })
})
