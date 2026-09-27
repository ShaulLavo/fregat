import { describe, expect, it } from 'vitest'

import {
  lspDiagnosticsFromTsserver,
  offersTsserverRequests,
  tsserverDiagnosticRequests,
} from '../tsserver-diagnostics'

function tsserverDiagnostic(overrides: Record<string, unknown> = {}) {
  return {
    start: { line: 1, offset: 1 },
    end: { line: 1, offset: 5 },
    text: 'Type error.',
    code: 2322,
    category: 'error',
    ...overrides,
  }
}

function response(body: readonly unknown[]) {
  return { success: true, body }
}

describe('offersTsserverRequests', () => {
  it('is true only when executeCommandProvider lists typescript.tsserverRequest', () => {
    expect(
      offersTsserverRequests({
        capabilities: { executeCommandProvider: { commands: ['typescript.tsserverRequest'] } },
      }),
    ).toBe(true)
  })

  it('is false when the command list is missing it, empty, or absent entirely', () => {
    expect(
      offersTsserverRequests({
        capabilities: { executeCommandProvider: { commands: ['editor.action.organizeImports'] } },
      }),
    ).toBe(false)
    expect(offersTsserverRequests({ capabilities: { executeCommandProvider: {} } })).toBe(false)
    expect(offersTsserverRequests({ capabilities: {} })).toBe(false)
    expect(offersTsserverRequests(null)).toBe(false)
    expect(offersTsserverRequests(undefined)).toBe(false)
    expect(offersTsserverRequests('typescript.tsserverRequest')).toBe(false)
  })
})

describe('tsserverDiagnosticRequests', () => {
  it('asks for both the syntactic and semantic sync commands against the given file', () => {
    expect(tsserverDiagnosticRequests('file:///repo/a.ts')).toEqual([
      {
        command: 'typescript.tsserverRequest',
        arguments: ['syntacticDiagnosticsSync', { file: 'file:///repo/a.ts' }],
      },
      {
        command: 'typescript.tsserverRequest',
        arguments: ['semanticDiagnosticsSync', { file: 'file:///repo/a.ts' }],
      },
    ])
  })
})

describe('lspDiagnosticsFromTsserver', () => {
  it('converts a 1-based line/offset location to a 0-based LSP position', () => {
    const diagnostics = lspDiagnosticsFromTsserver([
      response([
        tsserverDiagnostic({ start: { line: 1, offset: 1 }, end: { line: 3, offset: 9 } }),
      ]),
    ])
    expect(diagnostics).toEqual([
      expect.objectContaining({
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 8 } },
      }),
    ])
  })

  it('carries a surrogate-pair emoji offset through unchanged but for the 1-based shift', () => {
    // "😀😀 é" — tsserver already counts "😀" as two UTF-16 units, so an error starting
    // right after both emoji sits at offset 5 (1-based); no re-encoding happens here.
    const diagnostics = lspDiagnosticsFromTsserver([
      response([
        tsserverDiagnostic({ start: { line: 1, offset: 5 }, end: { line: 1, offset: 7 } }),
      ]),
    ])
    expect(diagnostics).toEqual([
      expect.objectContaining({
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 6 } },
      }),
    ])
  })

  it('carries a precomposed-accent (é) offset through unchanged but for the 1-based shift', () => {
    const diagnostics = lspDiagnosticsFromTsserver([
      response([
        tsserverDiagnostic({ start: { line: 2, offset: 3 }, end: { line: 2, offset: 4 } }),
      ]),
    ])
    expect(diagnostics).toEqual([
      expect.objectContaining({
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
      }),
    ])
  })

  it.each([
    ['error', 1],
    ['warning', 2],
    ['suggestion', 4],
    // typescript-language-server and VS Code both default anything but warning/suggestion to
    // Error, so a message-category diagnostic is Error, not Information.
    ['message', 1],
  ] as const)('maps category %s to LSP severity %d', (category, severity) => {
    const diagnostics = lspDiagnosticsFromTsserver([response([tsserverDiagnostic({ category })])])
    expect(diagnostics).toEqual([expect.objectContaining({ severity })])
  })

  it('carries the numeric code as-is and hardcodes the typescript source', () => {
    const diagnostics = lspDiagnosticsFromTsserver([
      response([tsserverDiagnostic({ code: 2304, text: 'Cannot find name.' })]),
    ])
    expect(diagnostics).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        severity: 1,
        message: 'Cannot find name.',
        code: 2304,
        source: 'typescript',
      },
    ])
  })

  it('leaves code undefined when tsserver reports none', () => {
    const [diagnostic] = lspDiagnosticsFromTsserver([
      response([tsserverDiagnostic({ code: undefined })]),
    ]) as [Record<string, unknown>]
    expect(diagnostic.code).toBeUndefined()
  })

  it('drops relatedInformation, reportsUnnecessary and reportsDeprecated rather than failing', () => {
    const diagnostics = lspDiagnosticsFromTsserver([
      response([
        tsserverDiagnostic({
          relatedInformation: [{ message: 'defined here' }],
          reportsUnnecessary: true,
          reportsDeprecated: true,
        }),
      ]),
    ])
    expect(diagnostics).toEqual([
      expect.not.objectContaining({
        relatedInformation: expect.anything(),
        reportsUnnecessary: expect.anything(),
        reportsDeprecated: expect.anything(),
      }),
    ])
  })

  it('combines diagnostics from every result, syntactic then semantic', () => {
    const syntactic = response([tsserverDiagnostic({ text: 'Syntax error.' })])
    const semantic = response([
      tsserverDiagnostic({ text: 'Semantic error one.' }),
      tsserverDiagnostic({ text: 'Semantic error two.' }),
    ])
    const diagnostics = lspDiagnosticsFromTsserver([syntactic, semantic])
    expect(diagnostics?.map((diagnostic) => (diagnostic as { message: string }).message)).toEqual([
      'Syntax error.',
      'Semantic error one.',
      'Semantic error two.',
    ])
  })

  it('returns null when any result failed on the backend', () => {
    const ok = response([tsserverDiagnostic()])
    const failed = { success: false }
    expect(lspDiagnosticsFromTsserver([ok, failed])).toBeNull()
    expect(lspDiagnosticsFromTsserver([failed, ok])).toBeNull()
  })

  it('returns null for a malformed or missing response shape', () => {
    expect(lspDiagnosticsFromTsserver([null])).toBeNull()
    expect(lspDiagnosticsFromTsserver([undefined])).toBeNull()
    expect(lspDiagnosticsFromTsserver([{}])).toBeNull()
    expect(
      lspDiagnosticsFromTsserver([{ success: true, body: [{ text: 'missing fields' }] }]),
    ).toBeNull()
    expect(
      lspDiagnosticsFromTsserver([
        { success: true, body: [tsserverDiagnostic({ category: 'not-a-real-category' })] },
      ]),
    ).toBeNull()
  })
})
