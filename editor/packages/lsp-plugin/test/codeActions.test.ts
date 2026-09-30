import {
  defaultEditorCommandPacks,
  editorCommandPackForCommand,
  editorKeymapLayerForCommandPack,
  readonlySafeEditorCommandPacks,
} from '@singapore-editor/core/editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LspWorkspace } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import { codeActionAutoTriggerRange, preferredQuickFix } from '../src/codeActions'
import {
  connectedEditor,
  DOCUMENT_URI,
  flushPromises,
  singleLineRange,
  type ConnectedEditor,
} from './connectedEditor'
import { syncedDocument } from './syncedDocument'
import { snapshotDocument } from './snapshotDocument'

const CODE_ACTION_ONLY_CAPABILITY: lsp.ServerCapabilities = { codeActionProvider: true }
const RESOLVING_CAPABILITY: lsp.ServerCapabilities = {
  codeActionProvider: { resolveProvider: true },
}

const UNUSED_VALUE: lsp.Diagnostic = {
  message: "'value' is declared but never read",
  range: singleLineRange(6, 11),
  severity: 2,
}

describe('what the client tells the server it can receive', () => {
  it('asks for code action literals it can rank, and for their edits on resolve', async () => {
    const editor = await connectedEditor('const value = 1', 6, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })
    const codeAction = editor.initializeParams().capabilities.textDocument?.codeAction

    // Undeclared, a conforming server is free to answer with bare commands, or not at all — and
    // every quick fix below would be unreachable through a green suite.
    expect(codeAction?.codeActionLiteralSupport?.codeActionKind.valueSet).toContain('quickfix')
    expect(codeAction?.isPreferredSupport).toBe(true)
    expect(codeAction?.dataSupport).toBe(true)
    expect(codeAction?.resolveSupport?.properties).toContain('edit')
  })
})

describe('picking the auto fix out of an answer', () => {
  it('takes a kind from anywhere under quickfix, and nothing from a sibling name', () => {
    expect(pick([spellingFix('fix', { kind: 'quickfix' })])?.title).toBe('fix')
    expect(pick([spellingFix('fix', { kind: 'quickfix.import' })])?.title).toBe('fix')
    expect(pick([spellingFix('fix', { kind: 'quickfixture' })])).toBeNull()
    expect(pick([spellingFix('fix', { kind: 'refactor.extract' })])).toBeNull()
    expect(pick([spellingFix('fix', { kind: undefined })])).toBeNull()
  })

  it('takes only what the server itself named preferred, and never a disabled one', () => {
    expect(pick([spellingFix('fix', { isPreferred: undefined })])).toBeNull()
    expect(pick([spellingFix('fix', { disabled: { reason: 'no import found' } })])).toBeNull()
  })

  it('keeps the answer the server sent in the order it sent it', () => {
    const first = spellingFix('first')
    const second = spellingFix('second', { diagnostics: [UNUSED_VALUE] })

    expect(pick([first, second])?.title).toBe('first')
    expect(pick([second, first])?.title).toBe('second')
  })

  it('has nothing to take from a refusal, or from an answer of bare commands', () => {
    expect(pick(null)).toBeNull()
    expect(
      pick([{ command: '_typescript.applyFix', title: 'Change spelling to import' }]),
    ).toBeNull()
  })

  it('skips a command-only action until the server says it fills edits in on request', () => {
    const lazy = spellingFix('fix', { data: { fixId: 7 }, edit: undefined })

    expect(preferredQuickFix([lazy], false)).toBeNull()
    expect(preferredQuickFix([lazy], true)?.title).toBe('fix')
  })
})

describe('automatic trigger range', () => {
  it('declines a caret enclosed in whitespace, and an empty line', () => {
    expect(codeActionAutoTriggerRange(snapshotDocument('  const'), 1, 1)).toBeNull()
    expect(codeActionAutoTriggerRange(snapshotDocument(''), 0, 0)).toBeNull()
    expect(codeActionAutoTriggerRange(snapshotDocument('  const'), 0, 0)).toBeNull()
    expect(codeActionAutoTriggerRange(snapshotDocument('const  '), 7, 7)).toBeNull()
  })

  it('asks whenever one side of the caret is text, or the user drew a selection', () => {
    expect(codeActionAutoTriggerRange(snapshotDocument('  const'), 2, 2)).toEqual({
      start: 2,
      end: 2,
    })
    expect(codeActionAutoTriggerRange(snapshotDocument('  const'), 7, 7)).toEqual({
      start: 7,
      end: 7,
    })
    expect(codeActionAutoTriggerRange(snapshotDocument('   '), 1, 3)).toEqual({ start: 1, end: 3 })
  })
})

describe('the code action oracle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('collapses a burst of caret movement into one request, 250ms after the last one', async () => {
    const editor = await connectedEditor('const value = 1', 6, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })

    editor.moveCaret(7)
    vi.advanceTimersByTime(200)
    editor.moveCaret(8)
    vi.advanceTimersByTime(249)
    await flushPromises()
    expect(editor.codeActionRequests()).toHaveLength(0)

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(editor.codeActionRequests()).toHaveLength(1)
  })

  it('asks for the quick-fix subtree and nothing wider', async () => {
    const editor = await connectedEditor('const value = 1', 6, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })

    editor.moveCaret(7)
    vi.advanceTimersByTime(250)
    await flushPromises()

    expect(editor.codeActionRequests()[0]?.context.only).toEqual(['quickfix'])
  })

  it('asks again when the server republishes diagnostics under a caret that has not moved', async () => {
    const editor = await connectedEditor('const value = 1', 6, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })

    editor.moveCaret(7)
    vi.advanceTimersByTime(250)
    await flushPromises()
    editor.answerCodeAction([])
    await flushPromises()
    expect(editor.codeActionRequests()).toHaveLength(1)

    editor.publishDiagnostics([UNUSED_VALUE])
    vi.advanceTimersByTime(250)
    await flushPromises()

    const requests = editor.codeActionRequests()
    expect(requests).toHaveLength(2)
    expect(requests[1]?.context.diagnostics).toEqual([UNUSED_VALUE])
  })

  it('does not re-ask over a publish the document sync refused', async () => {
    const editor = await connectedEditor('const value = 1', 6, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })

    editor.moveCaret(7)
    vi.advanceTimersByTime(250)
    await flushPromises()
    editor.answerCodeAction([])
    editor.publishDiagnostics([UNUSED_VALUE])
    vi.advanceTimersByTime(250)
    await flushPromises()
    editor.answerCodeAction([])
    expect(editor.codeActionRequests()).toHaveLength(2)

    // A version the buffer has already moved past: the diagnostics on screen are untouched, so
    // there is no new question to put to the server.
    editor.publishDiagnostics([UNUSED_VALUE], 99)
    vi.advanceTimersByTime(250)
    await flushPromises()

    expect(editor.codeActionRequests()).toHaveLength(2)
  })

  it('drops a settled fix the moment the text it was computed against changes', async () => {
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })
    await settledActions(editor, [spellingFix('Change spelling to import')])

    editor.type('!')

    expect(editor.runCommand('editor.action.autoFix')).toBe(false)
    await flushPromises()
    expect(editor.applyEdits).not.toHaveBeenCalled()
  })

  it('stays quiet while the caret sits between two blanks', async () => {
    const editor = await connectedEditor('  const value = 1', 8, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })

    editor.moveCaret(1)
    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(editor.codeActionRequests()).toHaveLength(0)

    editor.moveCaret(2)
    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(editor.codeActionRequests()).toHaveLength(1)
  })
})

describe('editor.action.autoFix', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('is bound to a key of its own', () => {
    const linux = editorKeymapLayerForCommandPack('lsp-editing', 'linux')
    const mac = editorKeymapLayerForCommandPack('lsp-editing', 'mac')

    expect(linux.bindings.map((binding) => binding.command)).toContain('editor.action.autoFix')
    expect(mac.bindings.map((binding) => binding.command)).toContain('editor.action.autoFix')
  })

  it('is classified into a pack the default keymap carries and a reader does not', () => {
    expect(editorCommandPackForCommand('editor.action.autoFix')).toBe('lsp-editing')
    expect(defaultEditorCommandPacks).toContain('lsp-editing')
    expect(readonlySafeEditorCommandPacks).not.toContain('lsp-editing')
  })

  it('dispatches the complete preferred fix with its owning lane', async () => {
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })
    await settledActions(editor, [
      { isPreferred: true, kind: 'refactor.extract', title: 'Extract to constant' },
      spellingFix('Change spelling to import'),
    ])

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    await flushPromises()
    expect(editor.workspaceEditRequests()).toHaveLength(1)
    expect(editor.workspaceEditRequests()[0]).toMatchObject({
      originUri: DOCUMENT_URI,
      serverId: 'editor.test-lsp',
      source: 'code-action',
      plan: {
        operations: [
          {
            kind: 'text-document',
            uri: DOCUMENT_URI,
            version: null,
            edits: [{ newText: 'import' }],
          },
        ],
      },
    })
    expect(editor.workspaceEditRequests()[0]?.guard.isCurrent(DOCUMENT_URI)).toBe(true)
  })

  it('dispatches with the owning lane version after a document change', async () => {
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })
    editor.editElsewhere({ from: 9, to: 9, text: ' ' })
    await settledActions(editor, [spellingFix('Change spelling to import')])

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    await flushPromises()

    expect(editor.workspaceEditRequests()).toHaveLength(1)
    expect(editor.workspaceEditRequests()[0]?.originVersion).toBe(1)
  })

  it('does not call the local completion edit feature for a WorkspaceEdit', async () => {
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })
    await settledActions(editor, [spellingFix('Change spelling to import')])

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    await flushPromises()

    expect(editor.workspaceEditRequests()).toHaveLength(1)
    expect(editor.applyEdits).not.toHaveBeenCalled()
  })

  it('rejects edit plus unsupported command without invoking the host or applying text', async () => {
    const editor = await connectedEditor('improt fs', 3, { capabilities: RESOLVING_CAPABILITY })
    const commandBearing = spellingFix('Change spelling to import', {
      command: { command: '_typescript.applyFix', title: 'Change spelling to import' },
    })
    await settledActions(editor, [commandBearing])

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    await flushPromises()
    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(editor.workspaceEditRequests()).toHaveLength(0)
    expect(String(editor.reportedErrors()[0])).toContain('server command')
  })

  it('resolves a lazy action before dispatching its complete edit', async () => {
    const editor = await connectedEditor('improt fs', 3, { capabilities: RESOLVING_CAPABILITY })
    const lazy = spellingFix('Change spelling to import', {
      data: { fixId: 7 },
      edit: undefined,
    })
    await settledActions(editor, [lazy])

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    editor.answerCodeActionResolve({ ...lazy, edit: replacement(0, 6, 'import') })
    await flushPromises()

    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(editor.workspaceEditRequests()).toHaveLength(1)
  })

  it.each(['initial-response', 'before-resolve', 'resolve-response'])(
    'rejects secondary-document drift at %s without dispatching stale edits',
    async (stage) => {
      let workspace: LspWorkspace | undefined
      const editor = await connectedEditor('improt fs', 3, {
        capabilities: RESOLVING_CAPABILITY,
        onConnectionCreated: (connection) => {
          workspace = connection.workspace
        },
      })
      const secondaryUri = 'file:///src/other.ts'
      const secondary = syncedDocument(workspace, secondaryUri, 'improt path')
      const edit = {
        changes: { [secondaryUri]: [{ newText: 'import', range: singleLineRange(0, 6) }] },
      }
      const action = spellingFix('Fix both imports', {
        data: { fixId: 9 },
        edit: stage === 'initial-response' ? edit : undefined,
      })
      editor.moveCaret(3)
      vi.advanceTimersByTime(250)
      await flushPromises()
      if (stage === 'initial-response') secondary.replace('const newer = 1')
      editor.answerCodeAction([action])
      await flushPromises()
      if (stage === 'before-resolve') secondary.replace('const newer = 1')

      expect(editor.runCommand('editor.action.autoFix')).toBe(true)
      if (stage === 'resolve-response') secondary.replace('const newer = 1')
      if (stage !== 'initial-response') editor.answerCodeActionResolve({ ...action, edit })
      await flushPromises()

      expect(editor.workspaceEditRequests()).toHaveLength(0)
      expect(editor.applyEdits).not.toHaveBeenCalled()
      expect(workspace?.getDocument(secondaryUri)?.textSnapshot.readRange(0, 15)).toBe(
        'const newer = 1',
      )
    },
  )

  it('keeps unrelated synchronized drift out of a lazy action guard decision', async () => {
    let workspace: LspWorkspace | undefined
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: RESOLVING_CAPABILITY,
      onConnectionCreated: (connection) => {
        workspace = connection.workspace
      },
    })
    const unrelated = syncedDocument(workspace, 'file:///src/unrelated.ts', 'const value = 1')
    const lazy = spellingFix('Fix import', { data: { fixId: 1 }, edit: undefined })
    await settledActions(editor, [lazy])
    const unknownUri = 'file:///src/opened-later.ts'
    syncedDocument(workspace, unknownUri, 'improt path')
    unrelated.replace('const value = 2')

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    editor.answerCodeActionResolve({
      ...lazy,
      edit: {
        changes: {
          [DOCUMENT_URI]: [{ newText: 'import', range: singleLineRange(0, 6) }],
          [unknownUri]: [{ newText: 'import', range: singleLineRange(0, 6) }],
        },
      },
    })
    await flushPromises()

    expect(editor.workspaceEditRequests()).toHaveLength(1)
    const request = editor.workspaceEditRequests()[0]
    expect(request?.guard.documents.some((document) => document.uri === unknownUri)).toBe(false)
    expect(request?.guard.isCurrent('file:///src/unrelated.ts')).toBe(false)
    expect(request?.guard.isCurrent(DOCUMENT_URI)).toBe(true)
  })

  it('lets the chord through when the server offers no fix it can carry out', async () => {
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })
    await settledActions(editor, [
      spellingFix('Change spelling to import', {
        command: { command: '_typescript.applyFix', title: 'Change spelling to import' },
        edit: undefined,
      }),
      spellingFix('Add the missing import', { isPreferred: undefined }),
    ])

    expect(editor.runCommand('editor.action.autoFix')).toBe(false)
    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(editor.reportedErrors()).toHaveLength(0)
  })

  it('dispatches a cross-file fix without applying its near half', async () => {
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
    })
    await settledActions(editor, [
      spellingFix('Rename the module everywhere', {
        edit: {
          changes: {
            [DOCUMENT_URI]: [{ newText: 'import', range: singleLineRange(0, 6) }],
            'file:///src/other.ts': [{ newText: 'import', range: singleLineRange(0, 6) }],
          },
        },
      }),
    ])

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    await flushPromises()

    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(editor.workspaceEditRequests()[0]?.plan.operations).toHaveLength(2)
  })

  it('cancels resolved-action application on document drift or disposal', async () => {
    const drifted = await connectedEditor('improt fs', 3, { capabilities: RESOLVING_CAPABILITY })
    const lazy = spellingFix('Change spelling to import', { data: { fixId: 7 }, edit: undefined })
    await settledActions(drifted, [lazy])

    expect(drifted.runCommand('editor.action.autoFix')).toBe(true)
    drifted.type('!')
    drifted.answerCodeActionResolve({ ...lazy, edit: replacement(0, 6, 'import') })
    await flushPromises()
    expect(drifted.workspaceEditRequests()).toHaveLength(0)

    const disposed = await connectedEditor('improt fs', 3, { capabilities: RESOLVING_CAPABILITY })
    await settledActions(disposed, [lazy])
    expect(disposed.runCommand('editor.action.autoFix')).toBe(true)
    disposed.dispose()
    disposed.answerCodeActionResolve({ ...lazy, edit: replacement(0, 6, 'import') })
    await flushPromises()
    expect(disposed.workspaceEditRequests()).toHaveLength(0)
  })

  it('reports one host failure and no partial local edits', async () => {
    const editor = await connectedEditor('improt fs', 3, {
      capabilities: CODE_ACTION_ONLY_CAPABILITY,
      onApplyWorkspaceEdit: async () => ({
        code: 'version-conflict',
        message: 'The proposal is stale.',
        status: 'failed',
      }),
    })
    await settledActions(editor, [spellingFix('Change spelling to import')])

    expect(editor.runCommand('editor.action.autoFix')).toBe(true)
    await flushPromises()

    expect(editor.reportedErrors()).toHaveLength(1)
    expect(String(editor.reportedErrors()[0])).toContain('version-conflict')
    expect(editor.applyEdits).not.toHaveBeenCalled()
  })
})

/** Moves the caret, lets the oracle fire, and answers it — the state a fix is applied from. */
async function settledActions(
  editor: ConnectedEditor,
  actions: readonly (lsp.Command | lsp.CodeAction)[],
): Promise<void> {
  editor.moveCaret(3)
  vi.advanceTimersByTime(250)
  await flushPromises()
  editor.answerCodeAction(actions)
  await flushPromises()
}

function pick(response: readonly (lsp.Command | lsp.CodeAction)[] | null): lsp.CodeAction | null {
  return preferredQuickFix(response, false)
}

/** The shape a server sends for the everyday auto fix: preferred, kinded, and carrying its edit. */
function spellingFix(title: string, rest: Partial<lsp.CodeAction> = {}): lsp.CodeAction {
  return {
    edit: replacement(0, 6, 'import'),
    isPreferred: true,
    kind: 'quickfix.spelling',
    title,
    ...rest,
  }
}

function replacement(start: number, end: number, newText: string): lsp.WorkspaceEdit {
  return { changes: { [DOCUMENT_URI]: [{ newText, range: singleLineRange(start, end) }] } }
}
