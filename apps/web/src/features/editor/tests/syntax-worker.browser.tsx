import chatModelSource from '../../../../../../packages/contracts/src/chat-model.ts?raw'
import { expect, test } from 'vitest'
import { createEditorRuntimeSessionId } from '@singapore-editor/core/syntax'
import { createEditorLoggingPlugin, type EditorLogEvent } from '@singapore-editor/core/logging'
import { Editor } from '@singapore-editor/core/editor'
import { createPieceTableSnapshot } from '@singapore-editor/core/document'
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
