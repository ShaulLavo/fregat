import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { activeEditorTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { awaitEditorSyntaxWorkerIdleFences } from '@/features/editor/state/syntax-highlighting'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import {
  awaitRetentionAcceptanceReady,
  retentionAcceptanceReference,
  retentionAcceptanceSubject,
} from '../../../../test/factories/retention-acceptance-paint'
import {
  captureRetentionAcceptanceProjection,
  retentionAcceptanceProjection,
  retentionAcceptanceProjectionMismatch,
  retentionAcceptanceFoldMismatch,
} from '../../../../test/factories/retention-acceptance-projection'

const path = filesystemPath('repo/src/editor-tab-a.ts')
const fixture =
  'export function foldAcceptance() {\n' +
  Array.from({ length: 24 }, (_, index) => `  const uniqueValue${index} = ${index}\n`).join('') +
  '  return uniqueValue0\n}\nexport const wrappedAcceptance = "' +
  '0123456789abcdef'.repeat(30) +
  '"\n'

test.for(['folded', 'wrapped'] as const)(
  '$0 mapping uses real source/view chunks and rejects offset, coverage, style and identity negatives',
  { timeout: 30_000 },
  async (arm, context) => {
    const app = await mountRetentionAcceptanceApp()
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    await awaitRetentionAcceptanceReady(app, path)
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    const controller = app.read().ui.getState().controllersByTabId.get(tab.id)
    expect(controller).toBeDefined()
    if (!controller) return
    const editor = controller.getEditor()
    expect(editor).not.toBeNull()
    if (!editor) return
    controller.commands.edit({
      from: 0,
      to: controller.materializeFullText().length,
      text: fixture,
    })
    await awaitRetentionAcceptanceReady(app, path)
    await awaitEditorSyntaxWorkerIdleFences()
    if (arm === 'folded') {
      expect(editor.toggleFold(0)).toBe(true)
      await expect
        .poll(() => controller.getSnapshot()?.foldMarkers.some((marker) => marker.collapsed))
        .toBe(true)
    } else {
      expect(editor.setWordWrap(true)).toBe(true)
      editor.setSelection(
        fixture.indexOf('wrappedAcceptance'),
        fixture.indexOf('wrappedAcceptance'),
        { reveal: true },
      )
      await expect
        .poll(() => controller.getSnapshot()?.visibleRows.some((row) => !row.firstWrapSegment))
        .toBe(true)
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const snapshot = controller.getSnapshot()
    const metadata = snapshot?.toVisibleSnapshot()?.toJSON()
    expect(snapshot).not.toBeNull()
    expect(metadata).toBeDefined()
    if (!snapshot || !metadata) return
    const reference = retentionAcceptanceReference(app, path)
    expect(snapshot.documentSyncPoint.revision).toBe(reference.identity.revision)
    expect(snapshot.textSnapshot.readRange(0, snapshot.textSnapshot.length)).toBe(reference.source)
    const binding = {
      identity: reference.identity,
      source: reference.source,
      editorTextVersion: snapshot.textVersion,
      presentation: 'live' as const,
    }
    expect(
      retentionAcceptanceProjection({
        metadata,
        binding: { ...binding, presentation: 'saved' },
        reference,
      }).kind,
    ).toBe('unsupported')
    const projection = retentionAcceptanceProjection({ metadata, binding, reference })
    await context.annotate(
      JSON.stringify({ arm, metadata, binding, reference, projection }),
      'retention-acceptance-projection-input',
    )
    expect(projection.kind).toBe('mapped')
    if (projection.kind !== 'mapped') return
    const group = allEditorGroups(
      app.read().workspace.getState().workbenchPanels.editorGroups,
    ).find((candidate) => candidate.selectedTabId === tab.id)
    expect(group).toBeDefined()
    if (!group) return
    const frame = captureRetentionAcceptanceProjection({
      projection,
      viewportSelector: `[data-editor-group-id="${group.id}"] .editor-virtualized-viewport`,
      observedIdentity: retentionAcceptanceSubject(app, path).identity,
    })
    await context.annotate(JSON.stringify({ arm, frame }), 'retention-acceptance-projection-raw')
    if (typeof commands.retentionAcceptanceScreenshot === 'function')
      await commands.retentionAcceptanceScreenshot(arm)
    expect(retentionAcceptanceProjectionMismatch(frame, projection)).toBeNull()
    expect(
      retentionAcceptanceFoldMismatch(
        projection,
        `[data-editor-group-id="${group.id}"] .editor-virtualized-viewport`,
      ),
    ).toBeNull()
    expect(
      retentionAcceptanceProjectionMismatch({ ...frame, rows: frame.rows.slice(1) }, projection),
    ).not.toBeNull()
    expect(
      retentionAcceptanceProjectionMismatch({ ...frame, runs: frame.runs.slice(1) }, projection),
    ).not.toBeNull()
    expect(
      retentionAcceptanceProjectionMismatch(
        { ...frame, identity: { ...frame.identity, revision: (frame.identity.revision ?? 0) + 1 } },
        projection,
      ),
    ).toBe('identity')
    expect(
      retentionAcceptanceProjectionMismatch(
        {
          ...frame,
          identity: { ...frame.identity, configuration: 'deliberately stale configuration' },
        },
        projection,
      ),
    ).toBe('identity')
    const first = frame.runs[0]
    expect(first).toBeDefined()
    if (!first) return
    const wrongStyle = {
      ...frame,
      runs: [
        { ...first, style: { ...first.style, color: 'deliberately wrong color' } },
        ...frame.runs.slice(1),
      ],
    }
    expect(retentionAcceptanceProjectionMismatch(wrongStyle, projection)).not.toBeNull()
    const shifted = {
      ...metadata,
      rows: metadata.rows.map((row) => ({
        ...row,
        chunks: row.chunks.map((chunk) => ({
          ...chunk,
          sourceStartOffset: chunk.sourceStartOffset + 1,
          sourceEndOffset: chunk.sourceEndOffset + 1,
        })),
      })),
    }
    expect(retentionAcceptanceProjection({ metadata: shifted, binding, reference }).kind).toBe(
      'unsupported',
    )
    const truncated = retentionAcceptanceProjection({
      metadata: { ...metadata, rows: metadata.rows.slice(1) },
      binding,
      reference,
    })
    expect(truncated.kind).toBe('mapped')
    if (truncated.kind === 'mapped')
      expect(retentionAcceptanceProjectionMismatch(frame, truncated)).not.toBeNull()
  },
)
