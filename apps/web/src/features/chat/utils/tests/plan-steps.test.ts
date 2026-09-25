import { describe } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'
import { mergePlanSteps, planStepKeys } from '@/features/chat/utils/plan-steps'

describe('plan steps', () => {
  it('matches steps by text and occurrence when the agent reorders and inserts', () => {
    const merged = mergePlanSteps(
      [
        { status: 'pending', step: 'Test' },
        { status: 'pending', step: 'Build' },
        { status: 'pending', step: 'Test' },
      ],
      [
        { status: 'inProgress', step: 'Lint' },
        { status: 'completed', step: 'Test' },
        { status: 'pending', step: 'Build' },
      ],
    )

    expect(merged).toEqual([
      { status: 'inProgress', step: 'Lint' },
      { status: 'completed', step: 'Test' },
      { status: 'pending', step: 'Build' },
      { status: 'dropped', step: 'Test' },
    ])
  })

  it('keeps a dropped step dropped even when the text comes back as a new step', () => {
    const dropped = mergePlanSteps(
      [
        { status: 'pending', step: 'Ship' },
        { status: 'pending', step: 'Tell the team' },
      ],
      [{ status: 'pending', step: 'Ship' }],
    )
    const again = mergePlanSteps(dropped, [
      { status: 'pending', step: 'Ship' },
      { status: 'pending', step: 'Tell the team' },
    ])

    expect(again).toEqual([
      { status: 'pending', step: 'Ship' },
      { status: 'dropped', step: 'Tell the team' },
      { status: 'pending', step: 'Tell the team' },
    ])
  })

  it('keys follow text, not index', () => {
    expect(
      planStepKeys([
        { status: 'dropped', step: 'Test' },
        { status: 'pending', step: 'Build' },
        { status: 'pending', step: 'Test' },
      ]),
    ).toEqual(['0:Test', '0:Build', '1:Test'])
  })
})
