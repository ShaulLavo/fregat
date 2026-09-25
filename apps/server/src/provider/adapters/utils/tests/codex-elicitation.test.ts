import { describe, expect, it } from 'vitest'
import type { ProviderApprovalDecision } from '@workspace/contracts'
import { parseCodexElicitation } from '../codex-elicitation'

// Codex's MCP tool-call approval, as `build_mcp_tool_approval_elicitation_request` emits it
// (codex-rs/core/src/mcp_tool_call_tests.rs).
const toolApproval = {
  threadId: 'provider-thread-1',
  turnId: 'turn-1',
  serverName: 'codex_apps',
  mode: 'form',
  message: 'Allow Calendar to create an event?',
  requestedSchema: { type: 'object', properties: {} },
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist: ['session', 'always'],
    source: 'connector',
    connector_id: 'calendar',
    connector_name: 'Calendar',
    connector_description: 'Manage events and schedules.',
    tool_title: 'Create Event',
    tool_description: 'Create a calendar event.',
    tool_params: { calendar_id: 'primary', title: 'Roadmap review' },
  },
}

const appAccessForm = {
  mode: 'form',
  message: 'Allow ChatGPT to use Safari?',
  serverName: 'computer-use',
  _meta: { persist: ['session', 'always'] },
  requestedSchema: {
    type: 'object',
    properties: {
      approval: {
        type: 'string',
        oneOf: [
          { const: 'once', title: 'Allow once' },
          { const: 'session', title: 'Always allow Safari for this session' },
          { const: 'always', title: 'Always allow Safari' },
        ],
      },
    },
    required: ['approval'],
  },
}

type Parsed = ReturnType<typeof parseCodexElicitation>

function decisions(params: unknown) {
  return options(parseCodexElicitation(params))?.map((option) => option.decision)
}

function options(parsed: Parsed) {
  return parsed?.offers.map((offer) => offer.option)
}

function response(parsed: Parsed, decision: ProviderApprovalDecision) {
  return parsed?.offers.find((offer) => offer.option.decision === decision)?.response
}

function withPersist(persist: unknown) {
  return { ...toolApproval, _meta: { ...toolApproval._meta, persist } }
}

describe('Codex MCP elicitation', () => {
  it('offers exactly the persistence Codex declares on a tool-call approval', () => {
    const parsed = parseCodexElicitation(toolApproval)
    expect(parsed?.detail).toBe('Calendar\nAllow Calendar to create an event?')
    expect(options(parsed)).toEqual([
      { decision: 'cancel', label: 'Cancel' },
      { decision: 'decline', label: 'Decline' },
      { decision: 'acceptForSession', label: 'Always allow this session' },
      { decision: 'acceptAlways', label: 'Always allow' },
      { decision: 'accept', label: 'Approve' },
    ])
    expect(response(parsed, 'accept')).toEqual({ action: 'accept', content: {} })
    expect(response(parsed, 'acceptForSession')).toEqual({
      action: 'accept',
      content: {},
      _meta: { persist: 'session' },
    })
    expect(response(parsed, 'acceptAlways')).toEqual({
      action: 'accept',
      content: {},
      _meta: { persist: 'always' },
    })
  })

  it('reads a single declared persist value', () => {
    expect(decisions(withPersist('session'))).toEqual([
      'cancel',
      'decline',
      'acceptForSession',
      'accept',
    ])
    expect(decisions(withPersist('always'))).toEqual([
      'cancel',
      'decline',
      'acceptAlways',
      'accept',
    ])
    expect(decisions(withPersist(undefined))).toEqual(['cancel', 'decline', 'accept'])
  })

  it('grants no persistence for values Codex does not declare', () => {
    for (const persist of [
      'forever',
      'permanent',
      'Always',
      'session-and-always',
      ['always allow for this session', 'persistent'],
      [true, 1],
      { session: true },
    ]) {
      expect(decisions(withPersist(persist))).toEqual(['cancel', 'decline', 'accept'])
    }
  })

  it('names the app by the declared connector, else the server', () => {
    const undocumented = { app_name: 'Safari', appName: 'Safari', target: { app: 'Safari' } }
    expect(parseCodexElicitation({ ...appAccessForm, _meta: undocumented })?.detail).toBe(
      'computer-use\nAllow ChatGPT to use Safari?',
    )
  })

  it('maps form options by their declared value, whatever their label says', () => {
    const parsed = parseCodexElicitation(appAccessForm)
    expect(options(parsed)).toEqual([
      { decision: 'cancel', label: 'Cancel' },
      { decision: 'decline', label: 'Decline' },
      { decision: 'acceptForSession', label: 'Always allow Safari for this session' },
      { decision: 'acceptAlways', label: 'Always allow Safari' },
      { decision: 'accept', label: 'Approve' },
    ])
    expect(response(parsed, 'accept')).toEqual({
      action: 'accept',
      content: { approval: 'once' },
    })
    expect(response(parsed, 'acceptForSession')).toEqual({
      action: 'accept',
      content: { approval: 'session' },
      _meta: { persist: 'session' },
    })
    expect(response(parsed, 'acceptAlways')).toEqual({
      action: 'accept',
      content: { approval: 'always' },
      _meta: { persist: 'always' },
    })
  })

  it('does not infer persistence from form fields the metadata never declared', () => {
    const parsed = parseCodexElicitation({
      ...appAccessForm,
      _meta: { persist: null },
      requestedSchema: {
        properties: {
          approval: { type: 'string', enum: ['once', 'session', 'always'] },
          persist: { type: 'boolean', title: 'Remember this choice permanently' },
        },
        required: ['approval'],
      },
    })
    expect(options(parsed)?.map((option) => option.decision)).toEqual([
      'cancel',
      'decline',
      'accept',
    ])
    expect(response(parsed, 'accept')).toEqual({
      action: 'accept',
      content: { approval: 'once' },
    })
  })

  it('withholds a declared persistence the required form cannot express', () => {
    const parsed = parseCodexElicitation({
      ...appAccessForm,
      requestedSchema: {
        properties: { approval: { enum: ['once', 'forever'] } },
        required: ['approval'],
      },
    })
    expect(options(parsed)?.map((option) => option.decision)).toEqual([
      'cancel',
      'decline',
      'accept',
    ])
  })

  it('declines URL requests and required fields an approval cannot populate', () => {
    expect(parseCodexElicitation({ ...appAccessForm, mode: 'url' })).toBeNull()
    expect(
      parseCodexElicitation({
        ...appAccessForm,
        requestedSchema: { properties: { email: { type: 'string' } }, required: ['email'] },
      }),
    ).toBeNull()
    expect(
      parseCodexElicitation({
        ...appAccessForm,
        requestedSchema: {
          properties: { approval: { enum: ['allow_always'] } },
          required: ['approval'],
        },
      }),
    ).toBeNull()
  })

  it('matches the pinned unknown-schema acceptance without content', () => {
    const parsed = parseCodexElicitation({ ...appAccessForm, requestedSchema: { properties: 123 } })
    expect(response(parsed, 'accept')).toEqual({ action: 'accept' })
    expect(response(parsed, 'acceptAlways')).toEqual({
      action: 'accept',
      _meta: { persist: 'always' },
    })
  })

  it('approves once with the first one-time value, as t3code does', () => {
    const parsed = parseCodexElicitation({
      ...appAccessForm,
      _meta: { persist: 'always' },
      requestedSchema: {
        properties: { approval: { enum: ['allow_always', 'accept', 'decline', 'always'] } },
        required: ['approval'],
      },
    })
    expect(response(parsed, 'accept')).toEqual({
      action: 'accept',
      content: { approval: 'accept' },
    })
    expect(response(parsed, 'acceptAlways')).toEqual({
      action: 'accept',
      content: { approval: 'always' },
      _meta: { persist: 'always' },
    })
  })
})
