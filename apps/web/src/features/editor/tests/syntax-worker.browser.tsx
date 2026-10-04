import chatModelSource from '../../../../../../packages/contracts/src/chat-model.ts?raw'
import { expect, test } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { createTestEditorRuntime } from '../../../../test/factories/editor-runtime'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { getClient } from '@/lib/client'
import { createClientInvariantError } from '@/lib/structured-errors'
import { createEditorRuntimeSessionId } from '@singapore-editor/core/syntax'
import { createEditorLoggingPlugin, type EditorLogEvent } from '@singapore-editor/core/logging'
import { Editor } from '@singapore-editor/core/editor'
import {
  createEditorBufferSession,
  createPieceTableSnapshot,
} from '@singapore-editor/core/document'
import { createHighlightingPlugin, createHighlightingService } from '@singapore-editor/highlighting'
import {
  resolveTreeSitterLanguageContribution,
  TreeSitterWorkerClient,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { resolveEditorShikiThemeRegistration } from '@/features/editor/state/color-theme-store'
import { createPlatformEditorLoggingPlugin } from '@/features/editor/utils/plugins'
import { clientLoggingEnabled, initializeClientLogging } from '@/lib/client-logging'

test('parses chat-model.ts through the editor Tree-sitter worker', async () => {
  const workerClient = new TreeSitterWorkerClient()
  try {
    await registerDefaultLanguages(workerClient)
    const snapshot = createPieceTableSnapshot(chatModelSource)
    const runtimeSessionId = createEditorRuntimeSessionId()
    const parsed = await workerClient.parse({
      documentId: 'packages/contracts/src/chat-model.ts',
      runtimeSessionId,
      snapshotVersion: 1,
      languageId: 'typescript',
      resultMode: 'parseOnly',
      snapshot,
    })
    const queried = await workerClient.queryRange({
      documentId: 'packages/contracts/src/chat-model.ts',
      runtimeSessionId,
      snapshotVersion: 1,
      languageId: 'typescript',
      includeCaptures: false,
      includeHighlights: true,
      range: { startIndex: 0, endIndex: chatModelSource.length },
    })

    expect(parsed?.snapshotVersion).toBe(1)
    // Range responses ship tokens as packed typed arrays (SoA transport);
    // the plain tokens field is no longer populated on the wire.
    expect(queried?.tokensPacked?.starts.length ?? 0).toBeGreaterThan(0)
  } finally {
    await workerClient.dispose()
  }
})

test('highlights TypeScript under an imported theme through the highlighting service', async () => {
  initializeClientLogging()
  const service = createHighlightingService({ resolveTheme: resolveEditorShikiThemeRegistration })
  const events: EditorLogEvent[] = []
  const container = document.createElement('div')
  container.style.height = '240px'
  container.style.width = '640px'
  document.body.append(container)

  const editor = new Editor(container, {
    plugins: [
      createHighlightingPlugin({ service, theme: { format: 'vscode', id: 'github-dark' } }),
      createPlatformEditorLoggingPlugin(),
      createEditorLoggingPlugin((event) => events.push(event)),
    ],
  })

  try {
    editor.openDocument({
      documentId: 'syntax-worker.ts',
      languageId: 'typescript',
      text: 'export const answer: number = 42',
    })

    await expect
      .poll(() => appliedHighlightTokenCount(events), { timeout: 20_000 })
      .toBeGreaterThan(0)
    expect(service.inspect().shiki?.lifecycle).toBe('ready')
    if (clientLoggingEnabled()) await new Promise((resolve) => setTimeout(resolve, 2_500))
  } finally {
    editor.dispose()
    container.remove()
    await service.dispose()
  }
})

test('final runtime disposal preserves another runtime borrowing the real shared highlighter', async () => {
  const service = createHighlightingService({ resolveTheme: resolveEditorShikiThemeRegistration })
  const provider = service.highlighterProvider({
    current: () => ({ format: 'vscode', id: 'github-dark' }),
  })
  const queriesA = new QueryClient()
  const queriesB = new QueryClient()
  const a = createTestEditorRuntime(queriesA)
  const b = createTestEditorRuntime(queriesB)

  try {
    const file = await fetchFile(
      filesystemPath('repo/src/editor-tab-a.ts'),
      new AbortController().signal,
      getClient(),
    )
    const documentA = a.documentStore.getState().ensureEditorView(tabId('worker-a'), file)
    const documentB = b.documentStore.getState().ensureEditorView(tabId('worker-b'), file)
    const request = { provider, languageId: 'typescript' }
    const leaseA = documentA.analysis.borrowHighlighter(request)
    const leaseB = documentB.analysis.borrowHighlighter(request)
    if (!leaseA || !leaseB) throw createClientInvariantError('The real highlighter has no session.')
    expect(leaseA.runtimeSessionId).not.toBe(leaseB.runtimeSessionId)
    const [resultA, resultB] = await Promise.all([
      leaseA.refresh(documentA.buffer.getTextSnapshot()),
      leaseB.refresh(documentB.buffer.getTextSnapshot()),
    ])
    expect(resultA.tokens.length).toBeGreaterThan(0)
    expect(resultB.tokens.length).toBeGreaterThan(0)

    a.resume()
    a.suspend()
    const retained = documentA.analysis.borrowHighlighter(request)
    expect(retained?.runtimeSessionId).toBe(leaseA.runtimeSessionId)
    retained?.dispose()
    a.dispose()
    expect(documentA.analysis.borrowHighlighter(request)).toBeNull()
    await service.awaitRuntimeSessionIdle(leaseA.runtimeSessionId)
    expect(service.inspect().disposed).toBe(false)
    expect(service.inspect().shiki?.lifecycle).toBe('ready')

    createEditorBufferSession(documentB.buffer).applyText('\nexport const survivor = 42\n')
    const currentB = await leaseB.refresh(documentB.buffer.getTextSnapshot())
    expect(currentB.tokens.length).toBeGreaterThan(0)
    expect(leaseB.read()).toMatchObject({
      kind: 'ready',
      revision: documentB.buffer.getRevision(),
    })
    b.dispose()
    expect(documentB.analysis.borrowHighlighter(request)).toBeNull()
    await service.awaitRuntimeSessionIdle(leaseB.runtimeSessionId)
    expect(service.inspect().shiki?.lifecycle).toBe('ready')
  } finally {
    a.dispose()
    b.dispose()
    queriesA.clear()
    queriesB.clear()
    await service.dispose()
  }
})

function appliedHighlightTokenCount(events: readonly EditorLogEvent[]): number {
  const event = events.findLast((event) => event.action === 'editor.syntax.highlight_applied')
  const syntax = event?.syntax as { readonly tokenCount?: unknown } | undefined
  return typeof syntax?.tokenCount === 'number' ? syntax.tokenCount : 0
}

async function registerDefaultLanguages(workerClient: TreeSitterWorkerClient): Promise<void> {
  const languages = await Promise.all(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.map((contribution) =>
      resolveTreeSitterLanguageContribution(contribution),
    ),
  )
  await workerClient.registerLanguages(languages)
}
