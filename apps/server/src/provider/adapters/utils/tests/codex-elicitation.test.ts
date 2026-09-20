import { describe, expect, it } from 'vitest'
import { parseCodexElicitation } from '../codex-elicitation'

const request = {
  mode: 'form',
  message: 'Allow ChatGPT to use Safari?',
  serverName: 'computer-use',
  _meta: { app_name: 'Safari', persist: ['session', 'always'] },
  requestedSchema: {
    type: 'object',
    properties: {
      approval: {
        type: 'string',
        oneOf: [
          { const: 'once', title: 'Allow once' },
          { const: 'session', title: 'Allow this session' },
          { const: 'always', title: 'Always allow Safari' },
        ],
      },
    },
    required: ['approval'],
  },
}

describe('Codex MCP elicitation', () => {
  it('preserves app identity and generates exact advertised response choices', () => {
    const parsed = parseCodexElicitation(request)
    expect(parsed?.detail).toContain('Safari')
    expect(parsed?.options).toEqual([
      { decision: 'cancel', label: 'Cancel' },
      { decision: 'decline', label: 'Decline' },
      { decision: 'acceptForSession', label: 'Allow this session' },
      { decision: 'acceptAlways', label: 'Always allow Safari' },
      { decision: 'accept', label: 'Approve' },
    ])
    expect(parsed?.responses.get('accept')).toEqual({
      action: 'accept',
      content: { approval: 'once' },
    })
    expect(parsed?.responses.get('acceptForSession')).toEqual({
      action: 'accept',
      content: { approval: 'session' },
      _meta: { persist: 'session' },
    })
    expect(parsed?.responses.get('acceptAlways')).toEqual({
      action: 'accept',
      content: { approval: 'always' },
      _meta: { persist: 'always' },
    })
    expect(parsed?.responses.get('cancel')).toEqual({ action: 'cancel' })
    expect(parsed?.responses.get('decline')).toEqual({ action: 'decline' })
  })

  it('keeps once-only forms from advertising unusable persistence choices', () => {
    const parsed = parseCodexElicitation({
      ...request,
      requestedSchema: {
        properties: { approval: { enum: ['once'] } },
        required: ['approval'],
      },
    })
    expect(parsed?.options.map((option) => option.decision)).toEqual([
      'cancel',
      'decline',
      'accept',
    ])
    expect(parsed?.responses.has('acceptAlways')).toBe(false)
    expect(parsed?.responses.has('acceptForSession')).toBe(false)
  })

  it('preserves nullable fields, enum labels, defaults and permanent boolean choices', () => {
    const parsed = parseCodexElicitation({
      ...request,
      _meta: { app_name: null, appName: 'Calendar', persist: null },
      requestedSchema: {
        properties: {
          approval: {
            type: 'string',
            title: null,
            description: null,
            default: null,
            enum: ['once', 'always'],
            enumNames: null,
          },
          persist: { type: 'boolean', title: 'Remember this choice' },
          constant: { default: 'fixed' },
        },
        required: ['approval', 'persist', 'constant'],
      },
    })
    expect(parsed?.detail).toContain('Calendar')
    expect(parsed?.responses.get('acceptAlways')).toEqual({
      action: 'accept',
      _meta: { persist: 'always' },
      content: { approval: 'always', persist: true, constant: 'fixed' },
    })
    expect(parsed?.responses.get('accept')).toEqual({
      action: 'accept',
      content: { approval: 'once', persist: false, constant: 'fixed' },
    })
  })

  it('declines URL requests and required fields an approval cannot populate', () => {
    expect(parseCodexElicitation({ ...request, mode: 'url' })).toBeNull()
    expect(
      parseCodexElicitation({
        ...request,
        requestedSchema: { properties: { email: { type: 'string' } }, required: ['email'] },
      }),
    ).toBeNull()
  })

  it('matches the pinned unknown-schema acceptance without content', () => {
    const parsed = parseCodexElicitation({ ...request, requestedSchema: { properties: 123 } })
    expect(parsed?.responses.get('accept')).toEqual({ action: 'accept' })
    expect(parsed?.responses.get('acceptAlways')).toEqual({
      action: 'accept',
      _meta: { persist: 'always' },
    })
  })
})
