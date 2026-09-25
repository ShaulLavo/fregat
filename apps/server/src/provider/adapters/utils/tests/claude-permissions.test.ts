import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import {
  claudeApprovalOptions,
  claudePermissionResult,
  claudePermissionUpdateCount,
} from '../claude-permissions'

const BASH_RULE: PermissionUpdate = {
  behavior: 'allow',
  destination: 'localSettings',
  rules: [{ ruleContent: 'bun test', toolName: 'Bash' }],
  type: 'addRules',
}
const ACCEPT_EDITS: PermissionUpdate = {
  destination: 'session',
  mode: 'acceptEdits',
  type: 'setMode',
}

function decisions(suggestions: PermissionUpdate[], suppressAlwaysAllowRule?: boolean) {
  return claudeApprovalOptions({ suggestions, suppressAlwaysAllowRule }).map(
    (option) => option.decision,
  )
}

describe('claudeApprovalOptions', () => {
  it('offers no always rule when the SDK suppresses it', () => {
    expect(decisions([BASH_RULE], true)).toEqual([
      'cancel',
      'decline',
      'acceptForSession',
      'accept',
    ])
  })

  it('offers no always rule when every suggestion is session-scoped', () => {
    expect(decisions([ACCEPT_EDITS])).not.toContain('acceptAlways')
  })
})

describe('claudePermissionResult', () => {
  it('writes "everywhere" to user settings and never to the committed project file', () => {
    const projectRule: PermissionUpdate = { ...BASH_RULE, destination: 'projectSettings' }
    const result = claudePermissionResult('acceptAlways', { command: 'bun test' }, [
      projectRule,
      ACCEPT_EDITS,
    ])

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'bun test' },
      updatedPermissions: [{ ...BASH_RULE, destination: 'userSettings' }, ACCEPT_EDITS],
    })
  })

  it('sends no updates for a one-off allow or a denial', () => {
    expect(claudePermissionResult('accept', {}, [BASH_RULE])).toEqual({
      behavior: 'allow',
      updatedInput: {},
    })
    expect(claudePermissionResult('decline', {}, [BASH_RULE])).toMatchObject({ behavior: 'deny' })
  })

  it('counts rules and modes for the wide event', () => {
    expect(claudePermissionUpdateCount([BASH_RULE, ACCEPT_EDITS])).toBe(2)
  })
})
