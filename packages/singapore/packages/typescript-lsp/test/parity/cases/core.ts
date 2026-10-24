import { offsetToLspPosition } from '@singapore-editor/lsp'
import { capabilityAdvertised, isRecord, type ParityCase, type ParitySession } from '../contract'
import {
  completionItems,
  diagnosticsFromReport,
  editedUris,
  hasSemanticTokens,
  hasTextEdits,
  hoverText,
  isRange,
  locationUris,
  records,
} from '../validators'
import { CORE_PROJECT, positionIn, positionOf } from './project'

export const CORE_CASES: readonly ParityCase[] = [
  {
    id: 'textDocument/hover',
    feature: 'hover',
    kind: 'required',
    methods: ['textDocument/hover'],
    capability: { kind: 'all', paths: ['hoverProvider'] },
    expectation: 'Hover identifies const circle: Circle',
    run: (s) =>
      s.client.request(
        'textDocument/hover',
        positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, 'circle ='),
        ),
      ),
    useful: (result) => hoverText(result).includes('const circle: Circle'),
  },
  {
    id: 'textDocument/definition',
    feature: 'definition',
    kind: 'required',
    methods: ['textDocument/definition'],
    capability: { kind: 'all', paths: ['definitionProvider'] },
    expectation: 'Definition targets the shapes file',
    run: (s) =>
      s.client.request(
        'textDocument/definition',
        positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, 'Circle(2'),
        ),
      ),
    useful: (result, s) =>
      locationUris(result).some((uri) => uri === s.uri(CORE_PROJECT.shapesPath)),
  },
  {
    id: 'textDocument/references',
    feature: 'references',
    kind: 'required',
    methods: ['textDocument/references'],
    capability: { kind: 'all', paths: ['referencesProvider'] },
    expectation: 'References include at least three circle uses',
    run: (s) =>
      s.client.request('textDocument/references', {
        ...positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, 'circle ='),
        ),
        context: { includeDeclaration: true },
      }),
    useful: (result) => locationUris(result).length >= 3,
  },
  {
    id: 'textDocument/implementation',
    feature: 'implementation',
    kind: 'required',
    methods: ['textDocument/implementation'],
    capability: { kind: 'all', paths: ['implementationProvider'] },
    expectation: 'Shape has an implementation location',
    run: (s) =>
      s.client.request(
        'textDocument/implementation',
        positionIn(s.uri(CORE_PROJECT.shapesPath), positionOf(CORE_PROJECT.shapesText, 'Shape {')),
      ),
    useful: (result) => locationUris(result).length > 0,
  },
  {
    id: 'textDocument/typeDefinition',
    feature: 'typeDefinition',
    kind: 'required',
    methods: ['textDocument/typeDefinition'],
    capability: { kind: 'all', paths: ['typeDefinitionProvider'] },
    expectation: 'Type definition targets the shapes file',
    run: (s) =>
      s.client.request(
        'textDocument/typeDefinition',
        positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, 'circle ='),
        ),
      ),
    useful: (result, s) =>
      locationUris(result).some((uri) => uri === s.uri(CORE_PROJECT.shapesPath)),
  },
  {
    id: 'textDocument/completion',
    feature: 'completion',
    kind: 'required',
    methods: ['textDocument/completion'],
    capability: { kind: 'all', paths: ['completionProvider'] },
    expectation: 'Member completion includes area after the unsaved edit',
    run: (s) => completionAtEdit(s),
    useful: (result) => completionItems(result).some((item) => item.label === 'area'),
  },
  {
    id: 'completionItem/resolve',
    feature: 'completion-detail',
    kind: 'variant',
    methods: ['textDocument/completion', 'completionItem/resolve'],
    capability: { kind: 'all', paths: ['completionProvider.resolveProvider'] },
    expectation: 'Resolved completion detail identifies Circle.area',
    run: async (s) => {
      const area = completionItems(await completionAtEdit(s)).find((item) => item.label === 'area')
      return area ? s.client.request('completionItem/resolve', area) : null
    },
    useful: usefulCompletionDetail,
  },
  {
    id: 'textDocument/signatureHelp',
    feature: 'signatureHelp',
    kind: 'required',
    methods: ['textDocument/signatureHelp'],
    capability: { kind: 'all', paths: ['signatureHelpProvider'] },
    expectation: 'Signature describes describe with active parameter 1',
    run: (s) =>
      s.client.request(
        'textDocument/signatureHelp',
        positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, "'circle'"),
        ),
      ),
    useful: (result) => {
      if (!isRecord(result)) return false
      const help = result
      const signature = records(help.signatures)[0]
      return (
        typeof signature?.label === 'string' &&
        signature.label.startsWith('describe(') &&
        help.activeParameter === 1
      )
    },
  },
  {
    id: 'textDocument/documentHighlight',
    feature: 'documentHighlight',
    kind: 'required',
    methods: ['textDocument/documentHighlight'],
    capability: { kind: 'all', paths: ['documentHighlightProvider'] },
    expectation: 'Highlights include at least three circle occurrences',
    run: (s) =>
      s.client.request(
        'textDocument/documentHighlight',
        positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, 'circle ='),
        ),
      ),
    useful: (result) => records(result).filter((highlight) => isRange(highlight.range)).length >= 3,
  },
  {
    id: 'textDocument/documentSymbol',
    feature: 'documentSymbol',
    kind: 'required',
    methods: ['textDocument/documentSymbol'],
    capability: { kind: 'all', paths: ['documentSymbolProvider'] },
    expectation: 'Circle outline includes the area child',
    run: (s) =>
      s.client.request('textDocument/documentSymbol', {
        textDocument: { uri: s.uri(CORE_PROJECT.shapesPath) },
      }),
    useful: (result) => {
      const circle = records(result).find((symbol) => symbol.name === 'Circle')
      return records(circle?.children).some((child) => child.name === 'area') === true
    },
  },
  {
    id: 'workspace/symbol',
    feature: 'symbol',
    kind: 'required',
    methods: ['workspace/symbol'],
    capability: { kind: 'all', paths: ['workspaceSymbolProvider'] },
    expectation: 'Workspace search finds Circle in the shapes file',
    run: (s) => s.client.request('workspace/symbol', { query: 'Circ' }),
    useful: (result, s) =>
      records(result).some(
        (symbol) =>
          symbol.name === 'Circle' &&
          isRecord(symbol.location) &&
          symbol.location.uri === s.uri(CORE_PROJECT.shapesPath),
      ),
  },
  {
    id: 'textDocument/prepareRename',
    feature: 'prepareRename',
    kind: 'required',
    methods: ['textDocument/prepareRename'],
    capability: { kind: 'all', paths: ['renameProvider.prepareProvider'] },
    expectation: 'Prepare rename selects Circle and preserves its supplied placeholder',
    run: (s) =>
      s.client.request(
        'textDocument/prepareRename',
        positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, 'Circle(2'),
        ),
      ),
    useful: (result) => usefulPrepareRename(result),
  },
  {
    id: 'textDocument/rename',
    feature: 'rename',
    kind: 'required',
    methods: ['textDocument/rename'],
    capability: { kind: 'all', paths: ['renameProvider'] },
    expectation: 'Rename edits both main and shapes files',
    // From the declaration: renamed at an import's use, TypeScript aliases the import instead.
    run: (s) =>
      s.client.request('textDocument/rename', {
        ...positionIn(
          s.uri(CORE_PROJECT.shapesPath),
          positionOf(CORE_PROJECT.shapesText, 'Circle implements'),
        ),
        newName: 'Round',
      }),
    useful: (result, s) => {
      const uris = editedUris(result)
      return (
        uris.includes(s.uri(CORE_PROJECT.mainPath)) && uris.includes(s.uri(CORE_PROJECT.shapesPath))
      )
    },
  },
  {
    id: 'textDocument/codeAction',
    feature: 'codeAction',
    kind: 'required',
    methods: ['textDocument/codeAction'],
    capability: { kind: 'all', paths: ['codeActionProvider'] },
    expectation: 'Preferred quick fix names circle and carries an edit',
    run: async (s) => {
      const diagnostics = await s.diagnostics()
      const misspelled = diagnostics.filter((diagnostic) => diagnostic.code === 2552)
      return s.client.request('textDocument/codeAction', {
        textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
        range: misspelled[0]?.range,
        context: { diagnostics: misspelled, only: ['quickfix'] },
      })
    },
    useful: (result) =>
      records(result).some(
        (action) =>
          action.isPreferred === true &&
          typeof action.title === 'string' &&
          action.title.includes("'circle'") &&
          editedUris(action.edit).length > 0,
      ),
  },
  {
    id: 'codeAction/resolve',
    feature: 'refactor',
    kind: 'variant',
    methods: ['textDocument/codeAction', 'codeAction/resolve'],
    capability: { kind: 'all', paths: ['codeActionProvider.resolveProvider'] },
    expectation: 'Resolved extract refactor edits the main file',
    run: async (s) => {
      const extract = (await extractionActions(s)).find((action) => !action.edit)
      return extract ? s.client.request('codeAction/resolve', extract) : null
    },
    useful: usefulRefactor,
  },
  {
    id: 'textDocument/formatting',
    feature: 'formatting',
    kind: 'required',
    methods: ['textDocument/formatting'],
    capability: { kind: 'all', paths: ['documentFormattingProvider'] },
    expectation: 'Document formatting returns valid text edits',
    run: (s) =>
      s.client.request('textDocument/formatting', {
        textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
        options: { tabSize: 2, insertSpaces: true },
      }),
    useful: hasTextEdits,
  },
  {
    id: 'textDocument/rangeFormatting',
    feature: 'rangeFormatting',
    kind: 'required',
    methods: ['textDocument/rangeFormatting'],
    capability: { kind: 'all', paths: ['documentRangeFormattingProvider'] },
    expectation: 'Range formatting returns valid text edits',
    run: (s) => {
      const line = positionOf(CORE_PROJECT.editedMainText, 'const   spaced').line
      return s.client.request('textDocument/rangeFormatting', {
        textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
        range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
        options: { tabSize: 2, insertSpaces: true },
      })
    },
    useful: hasTextEdits,
  },
  {
    id: 'textDocument/onTypeFormatting',
    feature: 'onTypeFormatting',
    kind: 'required',
    methods: ['textDocument/onTypeFormatting'],
    capability: { kind: 'all', paths: ['documentOnTypeFormattingProvider'] },
    expectation: 'On-type formatting returns valid text edits',
    run: (s) =>
      s.client.request('textDocument/onTypeFormatting', {
        ...positionIn(
          s.uri(CORE_PROJECT.mainPath),
          positionOf(CORE_PROJECT.editedMainText, '3;', 2),
        ),
        ch: ';',
        options: { tabSize: 2, insertSpaces: true },
      }),
    useful: hasTextEdits,
  },
  {
    id: 'textDocument/diagnostic',
    feature: 'diagnostics',
    kind: 'variant',
    methods: ['textDocument/diagnostic'],
    capability: { kind: 'all', paths: ['diagnosticProvider'] },
    expectation: 'Pull diagnostics returns a nonempty full report',
    run: (s) =>
      s.client.request('textDocument/diagnostic', {
        textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
      }),
    useful: (result) => {
      if (!isRecord(result)) return false
      const report = result
      return report.kind === 'full' && diagnosticsFromReport(report).length > 0
    },
  },
  {
    id: 'textDocument/semanticTokens/full',
    feature: 'semantic-color',
    kind: 'variant',
    methods: ['textDocument/semanticTokens/full'],
    capability: { kind: 'all', paths: ['semanticTokensProvider.full'] },
    expectation: 'Full semantic tokens contain valid token tuples',
    run: (s) =>
      s.client.request('textDocument/semanticTokens/full', {
        textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
      }),
    useful: hasSemanticTokens,
  },
  {
    id: 'textDocument/semanticTokens/range',
    feature: 'semantic-color',
    kind: 'variant',
    methods: ['textDocument/semanticTokens/range'],
    capability: { kind: 'all', paths: ['semanticTokensProvider.range'] },
    expectation: 'Range semantic tokens contain valid token tuples',
    run: (s) =>
      s.client.request('textDocument/semanticTokens/range', {
        textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
        range: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
      }),
    useful: hasSemanticTokens,
  },
  {
    id: 'diagnostics',
    feature: 'diagnostics',
    kind: 'required',
    methods: ['textDocument/publishDiagnostics', 'textDocument/diagnostic'],
    capability: { kind: 'always' },
    expectation: 'Diagnostics identify the missing name introduced only by the unsaved edit',
    run: (s) => s.diagnostics(),
    useful: (result) => {
      const start = positionOf(CORE_PROJECT.editedMainText, CORE_PROJECT.unsavedDiagnosticMarker)
      return records(result).some(
        (item) =>
          item.code === 2304 &&
          isRange(item.range) &&
          item.range.start.line === start.line &&
          item.range.start.character === start.character &&
          item.range.end.line === start.line &&
          item.range.end.character ===
            start.character + CORE_PROJECT.unsavedDiagnosticMarker.length,
      )
    },
  },
  {
    id: 'semantic-color',
    feature: 'semantic-color',
    kind: 'required',
    methods: ['textDocument/semanticTokens/full', 'textDocument/semanticTokens/range'],
    capability: {
      kind: 'any',
      paths: ['semanticTokensProvider.full', 'semanticTokensProvider.range'],
    },
    expectation: 'Semantic color receives valid tokens through an advertised full or range method',
    run: (s) =>
      capabilityAdvertised(s.capabilities, 'semanticTokensProvider.full')
        ? s.client.request('textDocument/semanticTokens/full', {
            textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
          })
        : s.client.request('textDocument/semanticTokens/range', {
            textDocument: { uri: s.uri(CORE_PROJECT.mainPath) },
            range: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
          }),
    useful: hasSemanticTokens,
  },
  {
    id: 'completion-detail',
    feature: 'completion-detail',
    kind: 'required',
    methods: ['textDocument/completion', 'completionItem/resolve'],
    capability: { kind: 'always' },
    expectation:
      'Member completion supplies Circle.area detail eagerly or through negotiated resolution',
    run: async (s) => {
      const area = completionItems(await completionAtEdit(s)).find((item) => item.label === 'area')
      if (!area || usefulCompletionDetail(area)) return area
      if (!capabilityAdvertised(s.capabilities, 'completionProvider.resolveProvider')) return area
      return s.client.request('completionItem/resolve', area)
    },
    useful: usefulCompletionDetail,
  },
  {
    id: 'extract-refactor',
    feature: 'refactor',
    kind: 'required',
    methods: ['textDocument/codeAction', 'codeAction/resolve'],
    capability: { kind: 'always' },
    expectation:
      'Extract refactor supplies main-file edits eagerly or through negotiated resolution',
    run: async (s) => {
      const actions = await extractionActions(s)
      const eager = actions.find((action) => usefulRefactor(action, s))
      if (eager) return eager
      if (!capabilityAdvertised(s.capabilities, 'codeActionProvider.resolveProvider')) return null
      const extract = actions.find((action) => !action.edit)
      return extract ? s.client.request('codeAction/resolve', extract) : null
    },
    useful: usefulRefactor,
  },
]

function completionAtEdit(session: ParitySession): Promise<unknown> {
  const text = CORE_PROJECT.editedMainText
  return session.client.request('textDocument/completion', {
    ...positionIn(session.uri(CORE_PROJECT.mainPath), offsetToLspPosition(text, text.length)),
    context: { triggerKind: 1 },
  })
}

function usefulCompletionDetail(result: unknown): boolean {
  return (
    isRecord(result) && typeof result.detail === 'string' && result.detail.includes('Circle.area')
  )
}

function usefulRefactor(result: unknown, session: ParitySession): boolean {
  return isRecord(result) && editedUris(result.edit).includes(session.uri(CORE_PROJECT.mainPath))
}

async function extractionActions(
  session: ParitySession,
): Promise<readonly Record<string, unknown>[]> {
  const start = positionOf(CORE_PROJECT.editedMainText, 'new Circle(2)')
  const end = positionOf(CORE_PROJECT.editedMainText, 'new Circle(2)', 'new Circle(2)'.length)
  return records(
    await session.client.request('textDocument/codeAction', {
      textDocument: { uri: session.uri(CORE_PROJECT.mainPath) },
      range: { start, end },
      context: { diagnostics: [], only: ['refactor.extract'], triggerKind: 1 },
    }),
  )
}

function usefulPrepareRename(result: unknown): boolean {
  if (!isRecord(result)) return false
  if (result.placeholder !== undefined && result.placeholder !== 'Circle') return false
  const range = isRecord(result.range) ? result.range : result
  if (!isRange(range) || !isRecord(range.start) || !isRecord(range.end)) return false
  const expected = positionOf(CORE_PROJECT.editedMainText, 'Circle(2)')
  return (
    range.start.line === expected.line &&
    range.start.character === expected.character &&
    range.end.line === expected.line &&
    range.end.character === expected.character + 'Circle'.length
  )
}
