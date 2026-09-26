import { describe, expect, it } from 'vitest'
import { codexGoalCommand, codexGoalReply, codexSessionGoal } from '../codex-goals'

describe('codex goal commands', () => {
  it('reads /goal as show, an action or an objective', () => {
    expect(codexGoalCommand('/goal')).toEqual({ kind: 'show' })
    expect(codexGoalCommand('  /goal Clear ')).toEqual({ kind: 'action', action: 'clear' })
    expect(codexGoalCommand('/goal pause')).toEqual({ kind: 'action', action: 'pause' })
    expect(codexGoalCommand('/goal make\nthe suite green')).toEqual({
      kind: 'objective',
      objective: 'make\nthe suite green',
    })
    expect(codexGoalCommand('/goals are nice')).toBeNull()
    expect(codexGoalCommand('please /goal x')).toBeNull()
  })

  it('maps thread goals and reports an unknown status as blocked', () => {
    const goal = {
      threadId: 't',
      objective: 'Ship',
      status: 'budgetLimited',
      tokenBudget: null,
      tokensUsed: 5,
      timeUsedSeconds: 2,
      createdAt: 1,
      updatedAt: 2,
    }
    expect(codexSessionGoal(goal)).toMatchObject({ status: 'budget-limited', tokenBudget: null })
    expect(codexSessionGoal({ ...goal, status: 'dreaming' }).status).toBe('blocked')
    expect(codexGoalReply({ kind: 'show' }, null)).toBe('No goal is set.')
  })
})
