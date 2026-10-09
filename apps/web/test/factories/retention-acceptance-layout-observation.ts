import { expect } from 'vitest'
import {
  retentionAcceptanceBinding,
  retentionAcceptanceReference,
  retentionAcceptanceSubject,
  awaitRetentionAcceptanceReady,
} from './retention-acceptance-paint'
import type { TabId, FilesystemPath } from '@/lib/documents/utils/types'
import { allEditorGroups } from '@/lib/documents/utils/groups'

import {
  captureRetentionAcceptanceProjection,
  retentionAcceptanceProjection,
  retentionAcceptanceProjectionMismatch,
  retentionAcceptanceFoldMismatch,
} from './retention-acceptance-projection'
import type { RetentionLayoutApp } from './retention-acceptance-layout-app'

export function captureRetentionLayoutView(
  app: RetentionLayoutApp,
  path: FilesystemPath,
  tabId: TabId,
) {
  const group = allEditorGroups(app.read().workspace.getState().workbenchPanels.editorGroups).find(
    (entry) => entry.selectedTabId === tabId,
  )
  const controller = app.read().ui.getState().controllersByTabId.get(tabId)
  const snapshot = controller?.getSnapshot()
  const editor = controller?.getEditor()
  const observedReferenceIdentity = {
    controller: app.identifyReference(controller),
    nativeEditor: app.identifyReference(editor),
    logicalViewSession: app.identifyReference(
      app.read().documents.getState().viewsByTabId[tabId]?.view,
    ),
  }
  if (!group || !snapshot || !editor)
    return {
      kind: 'unavailable',
      observedReferenceIdentity,
      tabId,
      groupPresent: Boolean(group),
      controllerPresent: Boolean(controller),
      nativePresent: Boolean(editor),
    } as const
  const selector = `[data-editor-group-id="${group.id}"] .editor-virtualized-viewport`
  const element = document.querySelector<HTMLElement>(selector)
  const header = document.querySelector<HTMLElement>(
    `[data-editor-group-id="${group.id}"] [data-editor-tab-id="${tabId}"][aria-selected="true"]`,
  )
  const metadata = snapshot.toVisibleSnapshot()?.toJSON() ?? null
  const captured = editor.captureSnapshot()
  const subject = retentionAcceptanceSubject(app, path)
  const canonicalModel = subject.document
  const ownership = {
    documentId: canonicalModel.analysis.documentId,
    revision: canonicalModel.buffer.getRevision(),
    source: canonicalModel.buffer.materializeFullText(),
    viewDocumentKey: app.read().documents.getState().viewsByTabId[tabId]?.documentKey ?? null,
    observedReferenceIdentity,
    bufferMatchesCanonical: captured ? captured.buffer === canonicalModel.buffer : null,
    configuredReceipt: JSON.stringify(subject.configuration),
  }
  const geometry = {
    width: element?.getBoundingClientRect().width ?? null,
    height: element?.getBoundingClientRect().height ?? null,
    scale: devicePixelRatio,
    fontStatus: document.fonts.status,
    font: element
      ? {
          family: getComputedStyle(element).fontFamily,
          size: getComputedStyle(element).fontSize,
          lineHeight: getComputedStyle(element).lineHeight,
        }
      : null,
    viewport: snapshot.viewport,
    folds: snapshot.foldMarkers,
    wrappedRows: snapshot.visibleRows.filter((row) => !row.firstWrapSegment).length,
    publicCapture: captured
      ? {
          documentId: captured.documentId,
          revision: captured.bufferRevision,
          textVersion: captured.textVersion,
          paint: captured.paint,
          bufferMatchesCanonical: captured.buffer === canonicalModel.buffer,
        }
      : null,
  }
  if (
    snapshot.syntaxStatus !== 'ready' ||
    snapshot.initialHighlightStatus !== 'painted' ||
    !metadata ||
    !captured
  )
    return {
      kind: 'pending',
      tabId,
      headerPath: header?.dataset.editorTabPath ?? null,
      ownership,
      geometry,
      syntaxStatus: snapshot.syntaxStatus,
      initialHighlightStatus: snapshot.initialHighlightStatus,
      metadata,
    } as const
  const reference = retentionAcceptanceReference(app, path)
  const binding = retentionAcceptanceBinding(app, path, snapshot)
  const projection = retentionAcceptanceProjection({ metadata, binding, reference })
  if (projection.kind !== 'mapped')
    return {
      kind: 'unsupported',
      tabId,
      headerPath: header?.dataset.editorTabPath ?? null,
      ownership,
      geometry,
      metadata,
      reference,
      binding,
      projection,
    } as const
  const frame = captureRetentionAcceptanceProjection({
    projection,
    viewportSelector: selector,
    observedOwner: binding,
  })
  return {
    kind: 'current',
    tabId,
    headerPath: header?.dataset.editorTabPath ?? null,
    ownership,
    geometry,
    metadata,
    reference,
    binding,
    projection,
    frame,
    mismatch:
      retentionAcceptanceProjectionMismatch(frame, projection) ??
      retentionAcceptanceFoldMismatch(projection, selector),
    privateInstalledTags: 'unknown',
    paintedGeneration: 'unknown',
  } as const
}

export function recordRetentionLayoutFrames(
  app: RetentionLayoutApp,
  path: FilesystemPath,
  tabIds: readonly TabId[],
) {
  const frames: {
    at: number
    origin: string
    views: ReturnType<typeof captureRetentionLayoutView>[]
    dom: {
      groupId: string | undefined
      headerPath: string | null
      rows: { text: string | null; html: string }[]
    }[]
  }[] = []
  let active = true
  const tick = () => {
    if (!active) return
    frames.push({
      at: performance.now(),
      origin: app.application.getSnapshot().origin,
      views: tabIds.map((id) => captureRetentionLayoutView(app, path, id)),
      dom: Array.from(
        document.querySelectorAll<HTMLElement>('[data-editor-group-id]'),
        (group) => ({
          groupId: group.dataset.editorGroupId,
          headerPath:
            group.querySelector<HTMLElement>('[data-editor-tab-id][aria-selected="true"]')?.dataset
              .editorTabPath ?? null,
          rows: Array.from(
            group.querySelectorAll<HTMLElement>('.editor-virtualized-row'),
            (row) => ({
              text: row.textContent,
              html: row.outerHTML,
            }),
          ),
        }),
      ),
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return {
    frames,
    stop: () => {
      active = false
    },
  }
}

export async function awaitRetentionLayoutCurrent(app: RetentionLayoutApp, path: FilesystemPath) {
  await awaitRetentionAcceptanceReady(app, path)
}

export function assertRecordedRetentionLayoutFrames(
  frames: ReturnType<typeof recordRetentionLayoutFrames>['frames'],
  path: FilesystemPath,
) {
  for (const frame of frames) {
    for (const view of frame.views) {
      if (view.kind !== 'current') continue
      expect(view.headerPath).toBe(path)
      expect(view.mismatch, JSON.stringify({ at: frame.at, view })).toBeNull()
      expect(view.ownership.bufferMatchesCanonical).toBe(true)
    }
  }
}
