import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allowsFileActions,
  isObserverOnly,
  isProduction,
  normalizeEnvironment,
  templateKeys,
} from './environments.js'

describe('environments', () => {
  it('translates legacy QA values', () => {
    assert.equal(normalizeEnvironment('gh'), 'gh_staging')
    assert.equal(normalizeEnvironment('prod_basic'), 'production_readonly')
    assert.equal(normalizeEnvironment('prod_full'), 'production_full_access')
  })

  it('falls back to sandbox for empty or unknown values', () => {
    assert.equal(normalizeEnvironment(''), 'sandbox')
    assert.equal(normalizeEnvironment(undefined), 'sandbox')
    assert.equal(normalizeEnvironment('nonsense'), 'sandbox')
  })

  it('does not treat production_full_access as observer-only', () => {
    assert.equal(isProduction('production_full_access'), true)
    assert.equal(isObserverOnly('production_full_access'), false)
    assert.equal(allowsFileActions('production_full_access'), true)
  })

  it('locks file actions on both observer tiers', () => {
    for (const env of ['production_readonly', 'production_restricted']) {
      assert.equal(isObserverOnly(env), true, env)
      assert.equal(allowsFileActions(env), false, env)
    }
  })

  it('falls back to the read-only template script for production_restricted', () => {
    assert.deepEqual(templateKeys('production_restricted'), [
      'production_restricted',
      'production_readonly',
      'prod_basic',
    ])
  })

  it('reads legacy template keys for renamed tiers', () => {
    assert.deepEqual(templateKeys('gh_staging'), ['gh_staging', 'gh'])
  })
})
