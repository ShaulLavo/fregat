import { describe, expect, it } from 'vitest'
import { correlateInputEvents } from '../input-correlation.mjs'

function observation(scenario = 'typing', views = 'single') {
  const preedit = scenario === 'composition-update'
  const scope = {
    typing: 'input.beforeinput',
    repeat: 'input.beforeinput',
    'composition-update': 'input.compositionupdate',
    'composition-commit': 'input.compositionend',
    paste: 'input.paste',
    undo: 'undo',
  }[scenario]
  const operation = { id: 17, input: scope, startedAtMs: 10 }
  const event = {
    id: 1,
    dispatchAt: 10,
    completedAt: 15,
    revisionBefore: 3,
    revisionAfter: preedit ? 3 : 4,
  }
  const diagnostics = [{ name: 'editor.input', timestampMs: 14, durationMs: 4, operation }]
  if (!preedit) diagnostics.unshift(...viewRecords(operation, views))
  return { events: [event], diagnostics, scenario, views, documentId: 'ordinary' }
}

function viewRecords(operation, views) {
  return Array.from({ length: views === 'multiple' ? 3 : 1 }, (_, index) => {
    const view = { id: `editor-${index}`, documentId: 'ordinary', documentVersion: 7, revision: 4 }
    return [
      { name: 'editor.document.committed', timestampMs: 11, operation, view },
      { name: 'editor.view.updated', timestampMs: 13, operation, view },
    ]
  }).flat()
}

describe('input diagnostic correlation', () => {
  it.each(['typing', 'repeat', 'composition-commit', 'paste', 'undo'])(
    'joins %s to all three affected views',
    (scenario) => {
      const input = observation(scenario, 'multiple')
      const [correlation] = correlateInputEvents(input)
      expect(correlation.eventId).toBe(1)
      expect(correlation.operation).toEqual(input.diagnostics[0].operation)
      expect(correlation.revision).toBe(4)
      expect(correlation.views).toHaveLength(3)
      expect(
        correlation.views.every(
          (view) =>
            view.documentVersion === 7 && view.committedAtMs === 11 && view.updatedAtMs === 13,
        ),
      ).toBe(true)
      expect(correlation.deferred).toEqual([])
    },
  )

  it('joins preedit only to its input operation and unchanged document revision', () => {
    const [correlation] = correlateInputEvents(observation('composition-update', 'multiple'))
    expect(correlation.operation.input).toBe('input.compositionupdate')
    expect(correlation.documentId).toBe('ordinary')
    expect(correlation.revision).toBe(3)
    expect(correlation.views).toEqual([])
  })

  it('retains deferred range work with its originating operation after later input', () => {
    const input = observation()
    const origin = input.diagnostics[0]
    input.diagnostics.push(
      { ...origin, name: 'editor.syntax.range.request', timestampMs: 30 },
      { ...origin, name: 'editor.syntax.range.apply', timestampMs: 40 },
      { ...origin, name: 'editor.secondary.features', timestampMs: 41 },
      {
        ...origin,
        name: 'editor.syntax.range.apply',
        timestampMs: 42,
        operation: { id: 18, input: 'input.beforeinput', startedAtMs: 16 },
        view: { ...origin.view, revision: 5 },
      },
    )
    const [correlation] = correlateInputEvents(input)
    expect(correlation.deferred.map((record) => record.timestampMs)).toEqual([30, 40, 41])
    expect(correlation.deferred.every((record) => record.view.revision === 4)).toBe(true)
  })

  it.each(['range', 'structural', 'highlight', 'warm'])(
    'correlates accepted %s syntax with the originating input and view',
    (phase) => {
      const input = observation()
      const accepted = {
        ...input.diagnostics[0],
        name: `editor.syntax.${phase}.accepted`,
        timestampMs: 30,
      }
      input.diagnostics.push(accepted)
      const [correlation] = correlateInputEvents(input)
      expect(correlation.deferred).toEqual([
        { name: accepted.name, timestampMs: 30, view: accepted.view },
      ])
    },
  )

  it.each([
    ['wrong document', { documentId: 'other' }, /Incorrect document/],
    ['stale revision', { revision: 3 }, /stale revision/],
    ['wrong generation', { documentVersion: 8 }, /originating view identity/],
    ['missing identity', { id: undefined }, /view id/],
  ])('rejects accepted syntax with %s', (_label, view, error) => {
    const input = observation()
    const origin = input.diagnostics[0]
    input.diagnostics.push({
      ...origin,
      name: 'editor.syntax.range.accepted',
      timestampMs: 30,
      view: { ...origin.view, ...view },
    })
    expect(() => correlateInputEvents(input)).toThrow(error)
  })

  it('permits timer ties within the stated epsilon when the identity is unique', () => {
    const input = observation()
    input.events[0].dispatchAt += 0.0000005
    input.events[0].completedAt = 14 - 0.0000005
    expect(correlateInputEvents(input)).toHaveLength(1)
  })

  it('rejects view updates after input completion and peer version disagreement', () => {
    const late = observation()
    late.diagnostics[1].timestampMs = 14.5
    expect(() => correlateInputEvents(late)).toThrow(/synchronous input interval/)
    const versions = observation('typing', 'multiple')
    versions.diagnostics[2].view.documentVersion = 8
    expect(() => correlateInputEvents(versions)).toThrow(/Affected views disagree/)
    const preedit = observation('composition-update')
    preedit.diagnostics.push(...viewRecords(preedit.diagnostics[0].operation, 'single'))
    expect(() => correlateInputEvents(preedit)).toThrow(/preedit committed/)
  })

  it.each([
    [
      'missing input',
      (input) => {
        input.diagnostics.pop()
      },
      /Missing or ambiguous operation/,
    ],
    [
      'ambiguous input',
      (input) => {
        input.diagnostics.push({
          ...input.diagnostics.at(-1),
          operation: { ...input.diagnostics[0].operation, id: 18 },
        })
      },
      /Missing or ambiguous operation/,
    ],
    [
      'duplicate input record',
      (input) => {
        input.diagnostics.push(input.diagnostics.at(-1))
      },
      /Missing or ambiguous operation/,
    ],
    [
      'input outside dispatch',
      (input) => {
        input.events[0].dispatchAt = 11
      },
      /Missing or ambiguous operation/,
    ],
    [
      'input after completion',
      (input) => {
        input.events[0].completedAt = 13
      },
      /Missing or ambiguous operation/,
    ],
    [
      'missing peer',
      (input) => {
        input.diagnostics.splice(2, 2)
      },
      /affected view diagnostics/,
    ],
    [
      'stale revision',
      (input) => {
        input.diagnostics[0] = {
          ...input.diagnostics[0],
          view: { ...input.diagnostics[0].view, revision: 3 },
        }
      },
      /stale revision/,
    ],
    [
      'wrong document',
      (input) => {
        input.documentId = 'other'
      },
      /Incorrect document/,
    ],
    [
      'mismatched version',
      (input) => {
        input.diagnostics[1] = {
          ...input.diagnostics[1],
          view: { ...input.diagnostics[1].view, documentVersion: 8 },
        }
      },
      /document version/,
    ],
    [
      'duplicate view id',
      (input) => {
        input.diagnostics[2] = { ...input.diagnostics[2], view: input.diagnostics[0].view }
      },
      /Duplicate affected view/,
    ],
    [
      'update after handler',
      (input) => {
        input.diagnostics[1].timestampMs = 20
      },
      /synchronous input interval/,
    ],
    [
      'inconsistent operation',
      (input) => {
        input.diagnostics[1].operation = { ...input.diagnostics[1].operation, startedAtMs: 9 }
      },
      /Conflicting operation identity/,
    ],
    [
      'invalid duration',
      (input) => {
        input.diagnostics.at(-1).durationMs = NaN
      },
      /handler duration/,
    ],
    [
      'duration exceeds interval',
      (input) => {
        input.diagnostics.at(-1).durationMs = 20
      },
      /operation interval/,
    ],
  ])('rejects %s', (_label, mutate, error) => {
    const input = observation('typing', 'multiple')
    mutate(input)
    expect(() => correlateInputEvents(input)).toThrow(error)
  })

  it('rejects reused identities, document-changing preedit, and stale deferred origin metadata', () => {
    const reused = observation()
    reused.events.push({ ...reused.events[0], id: 2 })
    expect(() => correlateInputEvents(reused)).toThrow(/multiple input events/)
    const preedit = observation('composition-update')
    preedit.events[0].revisionAfter++
    expect(() => correlateInputEvents(preedit)).toThrow(/preedit committed/)
    const stale = observation()
    stale.diagnostics.push({
      ...stale.diagnostics[0],
      name: 'editor.syntax.range.apply',
      timestampMs: 30,
      view: { ...stale.diagnostics[0].view, revision: 5 },
    })
    expect(() => correlateInputEvents(stale)).toThrow(/stale revision/)
  })
})
