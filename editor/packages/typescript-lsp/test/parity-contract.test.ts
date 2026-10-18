import { LspClient, LspResponseError, METHOD_NOT_FOUND } from '@singapore-editor/lsp'
import { describe, expect, it } from 'vitest'
import {
  capabilityAdvertised,
  runParityCases,
  uncoveredCapabilityPaths,
  unrunParityResults,
  type ParityCase,
  type ParitySession,
} from './parity/contract'
import { CORE_CASES } from './parity/cases/core'
import { CORE_PROJECT, positionOf } from './parity/cases/project'
import { hasSemanticTokens, hoverText, locationUris } from './parity/validators'

const ORIGINAL_METHODS = [
  'textDocument/hover',
  'textDocument/definition',
  'textDocument/references',
  'textDocument/implementation',
  'textDocument/typeDefinition',
  'textDocument/completion',
  'completionItem/resolve',
  'textDocument/signatureHelp',
  'textDocument/documentHighlight',
  'textDocument/documentSymbol',
  'workspace/symbol',
  'textDocument/prepareRename',
  'textDocument/rename',
  'textDocument/codeAction',
  'codeAction/resolve',
  'textDocument/formatting',
  'textDocument/rangeFormatting',
  'textDocument/onTypeFormatting',
  'textDocument/diagnostic',
  'textDocument/semanticTokens/full',
  'textDocument/semanticTokens/range',
]

function session(capabilities: ParitySession['capabilities'] = null): ParitySession {
  return {
    client: new LspClient(),
    capabilities,
    uri: (path) => new URL(path, 'file:///mapped-project/').href,
    diagnostics: async () => [],
  }
}

function row(run: ParityCase['run'] = async () => 'useful'): ParityCase {
  return {
    id: 'harness-test',
    feature: 'hover',
    kind: 'required',
    methods: ['textDocument/hover'],
    capability: { kind: 'all', paths: ['hoverProvider'] },
    expectation: 'Expected useful answer',
    run,
    useful: (result) => result === 'useful',
  }
}

describe('shared TypeScript parity contract', () => {
  it('retains every original useful-answer row and adds independent user outcomes', () => {
    expect(CORE_CASES.map((entry) => entry.id)).toEqual(
      ORIGINAL_METHODS.concat([
        'diagnostics',
        'semantic-color',
        'completion-detail',
        'extract-refactor',
      ]),
    )
    expect(new Set(CORE_CASES.map((entry) => entry.id)).size).toBe(CORE_CASES.length)
    expect(
      CORE_CASES.filter((entry) => !ORIGINAL_METHODS.includes(entry.id)).map((entry) => entry.kind),
    ).toEqual(['required', 'required', 'required', 'required'])
    for (const entry of CORE_CASES) {
      expect(entry.expectation.length).toBeGreaterThan(0)
      expect(entry.methods.length).toBeGreaterThan(0)
      expect(entry.useful(null, session()), entry.id).toBe(false)
      expect(entry.useful([], session()), entry.id).toBe(false)
      expect(entry.useful({ items: [], data: [] }, session()), entry.id).toBe(false)
    }
  })

  it('checks nested capabilities without treating a parent provider as resolve support', () => {
    const capabilities = { completionProvider: { resolveProvider: false } }
    expect(capabilityAdvertised(capabilities, 'completionProvider')).toBe(true)
    expect(capabilityAdvertised(capabilities, 'completionProvider.resolveProvider')).toBe(false)
    expect(capabilityAdvertised({ hoverProvider: 'yes' }, 'hoverProvider')).toBe(false)
    expect(capabilityAdvertised(null, 'hoverProvider')).toBe(false)
  })

  it('detects a removed nested method and newly advertised protocol variants', () => {
    const withoutResolve = CORE_CASES.filter((entry) => entry.id !== 'completionItem/resolve')
    expect(
      uncoveredCapabilityPaths({ completionProvider: { resolveProvider: true } }, withoutResolve),
    ).toEqual(['completionProvider.resolveProvider'])
    expect(
      uncoveredCapabilityPaths(
        {
          semanticTokensProvider: {
            legend: { tokenTypes: [], tokenModifiers: [] },
            full: { delta: true },
            range: false,
          },
          diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: true },
        },
        CORE_CASES,
      ),
    ).toEqual(['semanticTokensProvider.full.delta', 'diagnosticProvider.workspaceDiagnostics'])
    expect(
      uncoveredCapabilityPaths({ declarationProvider: true, hoverProvider: false }, CORE_CASES),
    ).toEqual(['declarationProvider'])
  })

  it('reports unavailable without executing the request and fails an unusable answer', async () => {
    let invoked = false
    const unavailable = await runParityCases(session(), [
      row(async () => {
        invoked = true
        return 'useful'
      }),
    ])
    expect(invoked).toBe(false)
    expect(unavailable[0]?.status).toBe('unavailable')
    expect(unavailable[0]?.capabilities).toEqual([{ path: 'hoverProvider', advertised: false }])
    const failed = await runParityCases(session({ hoverProvider: true }), [row(async () => [])])
    expect(failed[0]?.status).toBe('failed')
    expect(failed[0]?.reason).toBe('Expected useful answer')
  })

  it('fails missing required detail and refactor data while keeping absent resolve variants unavailable', async () => {
    const required = CORE_CASES.filter(
      (entry) => entry.id === 'completion-detail' || entry.id === 'extract-refactor',
    )
    expect(required.map((entry) => entry.capability)).toEqual([
      { kind: 'always' },
      { kind: 'always' },
    ])
    const empty = required.map((entry) => ({ ...entry, run: async () => null }))
    const results = await runParityCases(session(), empty)
    expect(results.map((result) => result.status)).toEqual(['failed', 'failed'])
    expect(results.map((result) => result.reason)).toEqual(
      required.map((entry) => entry.expectation),
    )
    const variants = CORE_CASES.filter(
      (entry) => entry.id === 'completionItem/resolve' || entry.id === 'codeAction/resolve',
    )
    expect((await runParityCases(session(), variants)).map((result) => result.status)).toEqual([
      'unavailable',
      'unavailable',
    ])
  })

  it('uses the original detail and edit validators for eager semantic results', () => {
    const detail = CORE_CASES.find((entry) => entry.id === 'completion-detail')
    const refactor = CORE_CASES.find((entry) => entry.id === 'extract-refactor')
    if (!detail || !refactor) expect.unreachable('Required semantic rows required')
    const mapped = session()
    expect(detail.useful({ label: 'area', detail: '(method) Circle.area(): number' }, mapped)).toBe(
      true,
    )
    expect(detail.useful({ label: 'area' }, mapped)).toBe(false)
    const range = { start: { line: 2, character: 15 }, end: { line: 2, character: 28 } }
    expect(
      refactor.useful(
        {
          edit: {
            changes: { [mapped.uri(CORE_PROJECT.mainPath)]: [{ range, newText: 'extracted' }] },
          },
        },
        mapped,
      ),
    ).toBe(true)
    expect(
      refactor.useful({ edit: { changes: { [mapped.uri(CORE_PROJECT.mainPath)]: [] } } }, mapped),
    ).toBe(false)
  })

  it('records MethodNotFound as failed and continues collecting the remaining cells', async () => {
    const missing = row(async () => {
      throw new LspResponseError({ code: METHOD_NOT_FOUND, message: 'Missing' })
    })
    const results = await runParityCases(session({ hoverProvider: true }), [
      missing,
      { ...row(), id: 'next' },
    ])
    expect(results.map((result) => result.status)).toEqual(['failed', 'supported'])
    expect(results[0]?.reason).toBe('Advertised method returned MethodNotFound')
  })

  it('records every unrun cell with its reason and without invented capability evidence', () => {
    const results = unrunParityResults(CORE_CASES, 'Backend binary is absent')
    expect(results.map((result) => result.caseId)).toEqual(CORE_CASES.map((entry) => entry.id))
    expect(
      results.every(
        (result) =>
          result.status === 'unrun' &&
          result.reason === 'Backend binary is absent' &&
          result.capabilities.length === 0,
      ),
    ).toBe(true)
  })

  it('maps navigation and rename assertions through the adapter URI', () => {
    const mapped = session()
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }
    const definition = CORE_CASES.find((entry) => entry.id === 'textDocument/definition')
    if (!definition) expect.unreachable('Definition row required')
    expect(definition.useful([{ uri: mapped.uri(CORE_PROJECT.shapesPath), range }], mapped)).toBe(
      true,
    )
    expect(definition.useful([{ uri: 'file:///src/shapes.ts', range }], mapped)).toBe(false)
    expect(
      locationUris([
        {
          targetUri: mapped.uri(CORE_PROJECT.shapesPath),
          targetRange: range,
          targetSelectionRange: range,
        },
      ]),
    ).toEqual([mapped.uri(CORE_PROJECT.shapesPath)])
  })

  it('accepts both valid prepare-rename forms and keeps the Circle placeholder assertion', () => {
    const prepare = CORE_CASES.find((entry) => entry.id === 'textDocument/prepareRename')
    if (!prepare) expect.unreachable('Prepare rename row required')
    const start = positionOf(CORE_PROJECT.editedMainText, 'Circle(2)')
    const range = { start, end: { line: start.line, character: start.character + 6 } }
    expect(prepare.useful(range, session())).toBe(true)
    expect(prepare.useful({ range, placeholder: 'Circle' }, session())).toBe(true)
    expect(prepare.useful({ range, placeholder: 'wrong' }, session())).toBe(false)
    expect(prepare.useful({ placeholder: 'Circle' }, session())).toBe(false)
  })

  it('rejects malformed semantic tokens while retaining the nonempty assertion', () => {
    expect(hasSemanticTokens({ data: [0, 0, 6, 1, 0] })).toBe(true)
    expect(hasSemanticTokens({ data: [] })).toBe(false)
    expect(hasSemanticTokens({ data: [0, 0, 6, 1] })).toBe(false)
    expect(hasSemanticTokens({ data: [0, 0, -6, 1, 0] })).toBe(false)
    expect(hasSemanticTokens({ data: ['0', 0, 6, 1, 0] })).toBe(false)
  })
})

describe('legal hover and fresh diagnostic contract shapes', () => {
  it('accepts mixed marked strings in legal hover contents', () => {
    expect(
      hoverText({
        contents: ['const circle: Circle', { language: 'typescript', value: 'area(): number' }],
      }),
    ).toBe('const circle: Circle\narea(): number')
  })

  it('accepts useful pull reports without requiring an optional result ID', () => {
    const row = CORE_CASES.find((entry) => entry.id === 'textDocument/diagnostic')
    if (!row) expect.unreachable('Pull case exists')
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
    expect(
      row.useful(
        { kind: 'full', items: [{ range, message: 'Fixture diagnostic', code: 2304 }] },
        session(),
      ),
    ).toBe(true)
  })

  it('rejects diagnostics from before the unsaved edit', () => {
    const row = CORE_CASES.find((entry) => entry.id === 'diagnostics')
    if (!row) expect.unreachable('Diagnostic outcome exists')
    const stale = {
      start: positionOf(CORE_PROJECT.mainText, 'circl)'),
      end: positionOf(CORE_PROJECT.mainText, 'circl)', 5),
    }
    expect(row.useful([{ code: 2552, message: 'Old error', range: stale }], session())).toBe(false)
    const start = positionOf(CORE_PROJECT.editedMainText, CORE_PROJECT.unsavedDiagnosticMarker)
    const range = {
      start,
      end: {
        line: start.line,
        character: start.character + CORE_PROJECT.unsavedDiagnosticMarker.length,
      },
    }
    expect(row.useful([{ code: 2304, message: 'New unsaved error', range }], session())).toBe(true)
  })
})
