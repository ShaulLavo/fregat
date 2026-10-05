import { expect, test } from 'vitest'
import { activeEditorTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { fileDocumentKey, fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { syncEditorThemeSelection } from '@/features/editor/state/color-theme-store'
import {
  awaitEditorSyntaxWorkerIdleFences,
  EDITOR_THEME_SOURCE,
} from '@/features/editor/state/syntax-highlighting'
import { savedDiffAttachment, diffAttachmentSubject } from '@/lib/diff-attachment'
import { joinRenderLines, projectDiffSyntaxTokens } from '@singapore-editor/diff'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import {
  awaitRetentionAcceptanceReady,
  retentionAcceptanceSubject,
} from '../../../../test/factories/retention-acceptance-paint'
import {
  observeDiffEditors,
  observeDiffSyntaxLoans,
  captureDiffSnapshot,
} from '../../../../test/factories/diff-attachment'

const path = filesystemPath('repo/src/editor-tab-a.ts')

test(
  'actual Saved attachments share compatible 197 loans and deliver exact finalized 198 projection paint',
  { timeout: 30_000 },
  async (context) => {
    const app = await mountRetentionAcceptanceApp()
    const saved = await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    await awaitRetentionAcceptanceReady(app, path)
    const document = retentionAcceptanceSubject(app, path).document
    const liveTab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)!
    const live = app.read().ui.getState().controllersByTabId.get(liveTab.id)!
    const before = live.materializeFullText()
    live.commands.edit({
      from: 0,
      to: before.length,
      text: before.replace('real browser', 'changed browser'),
    })
    await awaitRetentionAcceptanceReady(app, path)
    const loans = observeDiffSyntaxLoans()
    const observed = observeDiffEditors()
    const source = app
      .read()
      .documents.getState()
      .acquireSavedComparison({
        scope: { rootPath: app.rootPath, environmentId: activeEnvironmentId() },
        saved,
        signal: new AbortController().signal,
      })
    const preparedRead = source.read()
    if (preparedRead.kind !== 'ready') throw new RangeError('Actual prepared Saved source required')
    expect(
      await loans.service.prepareDiff(savedDiffAttachment(preparedRead).file, EDITOR_THEME_SOURCE),
    ).toBe(true)
    source.release()
    expect(
      await app
        .read()
        .commands.openTabContent(documentTab({ kind: 'compare-saved', file: fileResource(path) })),
    ).toMatchObject({ status: 'applied' })
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)!
    await expect
      .poll(() => app.container.querySelector('.editor-diff-pane')?.getAttribute('data-syntax'))
      .toBe('ready')
    await awaitEditorSyntaxWorkerIdleFences()
    const read = app.read().documents.getState().savedComparisonTabs.get(tab.id)?.read()
    if (read?.kind !== 'ready') throw new RangeError('Actual Saved attachment required')
    expect(read.live.buffer).toBe(document.buffer)
    expect(read.live.analysis).toBe(document.analysis)
    expect(read.live.revision).toBe(document.buffer.getRevision())
    const attachment = savedDiffAttachment(read)
    const pane = app.read().ui.getState().tabPresentation.get(tab.id).diffPanes.stacked.plugin!
    await expect.poll(() => observed.read('stacked').delivered?.paintLayers).not.toBeNull()
    const installed = observed.read('stacked').delivered!
    const visible = installed.toVisibleSnapshot()!.toJSON()
    expect(installed.documentId).toBe(
      `projection:diff:${diffAttachmentSubject(attachment).key}:stacked`,
    )
    expect(installed.textSnapshot.readRange(0, installed.textSnapshot.length)).toBe(
      joinRenderLines(pane.getRows()),
    )
    expect(installed.textSnapshot.readRange(0, installed.textSnapshot.length)).toContain(
      'changed browser',
    )
    expect(installed.tokens.toTokens()).toEqual(pane.getTokens())
    expect(installed.languageId).toBeNull()
    expect(installed.theme).toEqual(app.read().theme.editorTheme)
    expect(visible.textVersion).toBe(installed.textVersion)
    expect(
      visible.rows.flatMap((row) => row.chunks.flatMap((chunk) => chunk.runs)),
    ).not.toHaveLength(0)
    expect(visible.gutterLayout.lanes).not.toHaveLength(0)
    expect(
      visible.paintLayers.find((layer) => layer.id === 'diff-inline-stacked')?.rectangles.length,
    ).toBeGreaterThan(0)
    const firstLoan = loans.loans.find((loan) => !loan.released && loan.side === 'stacked')!
    expect(firstLoan.backend.kind).toBe('highlighter')
    expect(firstLoan.theme).toEqual({ format: 'vscode', id: 'dark-plus' })
    expect(firstLoan.readers).toHaveLength(2)
    expect(firstLoan.readers?.every((reader) => reader.tokens.length > 0)).toBe(true)
    expect(installed.tokens.toTokens()).toEqual(
      projectDiffSyntaxTokens({
        rows: pane.getRows(),
        side: 'stacked',
        sources: firstLoan.readers!,
      }),
    )
    expect(observed.installations[0]?.request.tokens?.length).toBeGreaterThan(0)
    const evidence = {
      source: {
        scope: read.scope,
        key: read.live.key,
        revision: read.live.revision,
        savedVersion: read.saved.snapshot.version,
      },
      installed: captureDiffSnapshot(installed),
      visible,
      firstTokens: observed.installations[0]?.request.tokens,
      service: loans.service.inspect(),
      configuration: {
        backend: firstLoan.backend.kind,
        language: firstLoan.file.languageId,
        path: firstLoan.file.path,
        theme: firstLoan.theme,
        themeId: app.read().theme.appliedThemeId,
        themeContentHash: app.read().theme.appliedThemeContentHash,
      },
    }
    context.task.meta.attachment200 = evidence
    await context.annotate(JSON.stringify(evidence), 'attachment200-finalized-paint')

    const groups = app.read().workspace.getState().workbenchPanels.editorGroups
    expect(
      await app.read().commands.placeTab({
        tabId: tab.id,
        mode: 'copy',
        target: { kind: 'edge', groupId: groups.activeGroupId, edge: 'right' },
      }),
    ).toMatchObject({ status: 'applied' })
    await expect.poll(() => loans.service.inspect().diffs.borrowed).toBe(4)
    await expect.poll(() => loans.loans.filter((loan) => !loan.released).length).toBe(2)
    const activeLoans = loans.loans.filter((loan) => !loan.released)
    expect(activeLoans[0]!.readers?.[0]).not.toBe(activeLoans[1]!.readers?.[0])
    expect(activeLoans[0]!.readers?.[0]?.tokens).toBe(activeLoans[1]!.readers?.[0]?.tokens)
    expect(activeLoans[0]!.readers?.[1]?.tokens).toBe(activeLoans[1]!.readers?.[1]?.tokens)
    const tabs = allEditorGroups(
      app.read().workspace.getState().workbenchPanels.editorGroups,
    ).flatMap((group) => group.tabs)
    const copied = tabs.find(
      (candidate) =>
        candidate.id !== tab.id &&
        candidate.content.kind === 'document' &&
        candidate.content.document.kind === 'compare-saved',
    )!
    expect(await app.read().commands.closeTab(copied.id)).toMatchObject({ status: 'applied' })
    await expect.poll(() => loans.service.inspect().diffs.borrowed).toBe(2)
    expect(
      app.read().documents.getState().getLiveEditorDocument(fileDocumentKey(path))?.buffer,
    ).toBe(document.buffer)
  },
)

test.for(['resolve', 'reject'] as const)(
  '$0 of real old-source readers cannot replace current theme/backend paint',
  { timeout: 30_000 },
  async (outcome, context) => {
    const app = await mountRetentionAcceptanceApp()
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    await awaitRetentionAcceptanceReady(app, path)
    const document = retentionAcceptanceSubject(app, path).document
    const liveTab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)!
    const live = app.read().ui.getState().controllersByTabId.get(liveTab.id)!
    live.commands.edit({ from: 0, to: 0, text: 'export const oldLoan = 10\n' })
    await awaitRetentionAcceptanceReady(app, path)
    const loans = observeDiffSyntaxLoans()
    const observed = observeDiffEditors()
    loans.holdNext()
    expect(
      await app
        .read()
        .commands.openTabContent(documentTab({ kind: 'compare-saved', file: fileResource(path) })),
    ).toMatchObject({ status: 'applied' })
    await expect.poll(() => loans.holds[0]?.readers?.length).toBe(2)
    expect(app.container.querySelector('.editor-diff-pane')?.getAttribute('data-syntax')).toBe(
      'pending',
    )
    const held = loans.holds[0]!
    const oldReaders = held.readers!
    const editing = createEditorBufferSession(document.buffer)
    editing.setSelection(0, 'export const oldLoan = 10\n'.length)
    editing.applyText('export const currentLoan = 20\n')
    syncEditorThemeSelection('dark', 'tree-sitter-dark')
    await expect.poll(() => app.read().theme.appliedThemeId).toBe('tree-sitter-dark')
    await expect
      .poll(() => app.container.querySelector('.editor-diff-pane')?.getAttribute('data-syntax'))
      .toBe('ready')
    const current = observed.read('stacked')
    const text = current.editor.materializeFullText()
    expect(text).toContain('currentLoan')
    expect(text).not.toContain('oldLoan')
    const currentTokens = current.delivered!.tokens.toTokens()
    expect(current.delivered!.theme).toEqual(app.read().theme.editorTheme)
    if (outcome === 'resolve') held.completion.resolve()
    else held.completion.reject(new RangeError('Controlled old reader refusal'))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(observed.read('stacked').editor.materializeFullText()).toBe(text)
    expect(observed.read('stacked').delivered!.tokens.toTokens()).toEqual(currentTokens)
    expect(observed.read('stacked').delivered!.theme).toEqual(app.read().theme.editorTheme)
    expect(loans.loans.find((loan) => !loan.released)?.backend.kind).toBe('tree-sitter')
    expect(document.buffer.materializeFullText()).toContain('currentLoan')
    const evidence = {
      outcome,
      oldReaderCount: oldReaders.length,
      currentText: text,
      installed: captureDiffSnapshot(observed.read('stacked').delivered!),
      service: loans.service.inspect(),
    }
    context.task.meta.attachment200 = evidence
    await context.annotate(JSON.stringify(evidence), 'attachment200-stale-real-readers')
  },
)
