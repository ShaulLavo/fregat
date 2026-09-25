import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderApprovalDecision } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'
import { claudeApprovalOffers, claudePermissionUpdateCount } from '../claude-permissions'

const INPUT = { command: 'bun test' }
const BASH_RULE: PermissionUpdate = {
  behavior: 'allow',
  destination: 'localSettings',
  rules: [{ ruleContent: 'bun test', toolName: 'Bash' }],
  type: 'addRules',
}
const READ_OUTSIDE: PermissionUpdate = {
  destination: 'session',
  directories: ['/work/tmp/shared'],
  type: 'addDirectories',
}
const ACCEPT_EDITS: PermissionUpdate = {
  destination: 'localSettings',
  mode: 'acceptEdits',
  type: 'setMode',
}
const REPLACE_RULES: PermissionUpdate = { ...BASH_RULE, type: 'replaceRules' }

function offers(suggestions: PermissionUpdate[], suppressAlwaysAllowRule?: boolean) {
  return claudeApprovalOffers({ suggestions, suppressAlwaysAllowRule }, INPUT)
}

function decisions(suggestions: PermissionUpdate[], suppressAlwaysAllowRule?: boolean) {
  return offers(suggestions, suppressAlwaysAllowRule).map((offer) => offer.option.decision)
}

function result(suggestions: PermissionUpdate[], decision: ProviderApprovalDecision) {
  return offers(suggestions).find((offer) => offer.option.decision === decision)?.response
}

function written(response: PermissionResult | undefined) {
  return response?.behavior === 'allow' ? response.updatedPermissions : undefined
}

describe('claudeApprovalOffers', () => {
  it('offers session and both always scopes for a portable rule', () => {
    expect(decisions([BASH_RULE])).toEqual([
      'cancel',
      'decline',
      'acceptForSession',
      'acceptAlwaysInProject',
      'acceptAlways',
      'accept',
    ])
  })

  it('offers nothing remembered when the SDK suppresses the rule, not even for the session', () => {
    expect(decisions([BASH_RULE], true)).toEqual(['cancel', 'decline', 'accept'])
  })

  it('offers no always rule when every grant is session-scoped', () => {
    expect(decisions([READ_OUTSIDE])).toEqual(['cancel', 'decline', 'acceptForSession', 'accept'])
  })

  it('never applies a mode change or a rule replacement', () => {
    expect(decisions([ACCEPT_EDITS, REPLACE_RULES])).toEqual(['cancel', 'decline', 'accept'])
    expect(written(result([BASH_RULE, ACCEPT_EDITS, REPLACE_RULES], 'acceptForSession'))).toEqual([
      { ...BASH_RULE, destination: 'session' },
    ])
  })

  it.each([
    ['a cwd-relative path rule', { toolName: 'Edit', ruleContent: 'src/**' }],
    ['a settings-relative path rule', { toolName: 'Read', ruleContent: '/src/**' }],
    ['a repository script', { toolName: 'Bash', ruleContent: './scripts/deploy.sh' }],
    ['a parent-relative argument', { toolName: 'Bash', ruleContent: 'cat ../notes.md' }],
  ])('keeps %s out of user settings', (_, rule) => {
    const update: PermissionUpdate = { ...BASH_RULE, rules: [rule] }
    expect(decisions([update])).toContain('acceptAlwaysInProject')
    expect(decisions([update])).not.toContain('acceptAlways')
  })

  it('offers everywhere for absolute and home-relative paths', () => {
    const update: PermissionUpdate = {
      ...BASH_RULE,
      rules: [
        { toolName: 'Read', ruleContent: '//work/tmp/**' },
        { toolName: 'Edit', ruleContent: '~/notes/**' },
      ],
    }
    expect(decisions([update])).toContain('acceptAlways')
  })
})

describe('claude permission results', () => {
  it('writes "everywhere" to user settings, never the committed project file, and keeps session grants', () => {
    const projectRule: PermissionUpdate = { ...BASH_RULE, destination: 'projectSettings' }

    expect(result([projectRule, READ_OUTSIDE], 'acceptAlways')).toEqual({
      behavior: 'allow',
      updatedInput: INPUT,
      updatedPermissions: [{ ...BASH_RULE, destination: 'userSettings' }, READ_OUTSIDE],
    })
    expect(written(result([projectRule], 'acceptAlwaysInProject'))).toEqual([BASH_RULE])
  })

  it('sends no updates for a one-off allow or a denial', () => {
    expect(result([BASH_RULE], 'accept')).toEqual({ behavior: 'allow', updatedInput: INPUT })
    expect(result([BASH_RULE], 'decline')).toMatchObject({ behavior: 'deny' })
  })

  it('counts rules and directories for the wide event', () => {
    expect(claudePermissionUpdateCount([BASH_RULE, READ_OUTSIDE])).toBe(2)
  })
})
