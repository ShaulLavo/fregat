import { describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import { diagnosticNotes } from '../src/diagnosticNotes'

const RANGE: lsp.Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }

describe('diagnosticNotes', () => {
  it('retains the diagnostic identity when combined notes request host actions', () => {
    const first = { range: RANGE, message: 'first' }
    const second = { range: RANGE, message: 'second' }
    const run = vi.fn()
    const notes = diagnosticNotes(
      [first, second],
      () => undefined,
      (diagnostic) => [{ label: 'Inspect', run: () => run(diagnostic) }],
    )
    notes[1]?.actions?.[0]?.run()
    expect(run).toHaveBeenCalledExactlyOnceWith(second)
  })

  it('carries the source, code, documentation link and related locations', () => {
    const open = vi.fn()
    const [note] = diagnosticNotes(
      [
        {
          range: RANGE,
          severity: 2,
          message: 'Expected expression to be used\nhelp: Consider removing it',
          source: 'oxc',
          code: 'no-unused-expressions',
          codeDescription: { href: 'https://oxc.rs/rules/no-unused-expressions' },
          relatedInformation: [
            {
              location: {
                uri: 'file:///work/src/other.ts',
                range: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
              },
              message: 'first declared here',
            },
          ],
        },
      ],
      open,
    )

    expect(note).toMatchObject({
      text: 'Expected expression to be used\nhelp: Consider removing it',
      source: 'oxc',
      code: 'no-unused-expressions',
      codeHref: 'https://oxc.rs/rules/no-unused-expressions',
    })
    expect(note?.related?.[0]).toMatchObject({
      label: 'other.ts(4, 2): ',
      text: 'first declared here',
    })
    note?.related?.[0]?.open()
    expect(open).toHaveBeenCalledWith({
      uri: 'file:///work/src/other.ts',
      path: 'work/src/other.ts',
      range: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
    })
  })

  it('shows a numeric code as text and drops a related location it cannot place', () => {
    const [note] = diagnosticNotes(
      [
        {
          range: RANGE,
          message: 'never read',
          source: 'typescript',
          code: 6133,
          relatedInformation: [
            { location: { uri: 'untitled:one', range: RANGE }, message: 'elsewhere' },
          ],
        },
      ],
      () => undefined,
    )
    expect(note).toMatchObject({ code: '6133', related: [] })
  })
})
