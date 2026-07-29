import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildJumpPlan, pickJumpTarget, type JumpOption } from './jumpTargets.js'

describe('jumpTargets', () => {
  it('prefers runtime_contract candidates over dropdown order', () => {
    const plan = buildJumpPlan('hrms', ['HRMS'], {})
    const options: JumpOption[] = [
      { value: 'books', label: 'Smart Books' },
      { value: 'hrms', label: 'HRMS' },
    ]
    const pick = pickJumpTarget(options, plan)
    assert.equal(pick?.option.label, 'HRMS')
    assert.equal(pick?.matchedPreference, 'HRMS')
  })

  it('does not use Books family fallback for HRMS', () => {
    const plan = buildJumpPlan('hrms', [], {})
    assert.equal(plan.booksFamily, false)
    assert.ok(!plan.preferred.includes('Smart Books'))
  })

  it('allows Books family fallback for books', () => {
    const plan = buildJumpPlan('books', [], {})
    assert.equal(plan.booksFamily, true)
    assert.ok(plan.preferred.includes('Smart Books'))
  })
})
