import { expect } from 'vitest'
import { editorHighlighterProvider } from '@/features/editor/state/syntax-highlighting'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import { allEditorGroups } from '@/lib/documents/utils/groups'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { createClientInvariantError } from '@/lib/structured-errors'
import {
  captureTokenPaint,
  resolveTokenPaintRuns,
  sourceTokenPaintWindow,
  tokenPaintMismatch,
  type TokenPaintObservation,
  type TokenPaintReference,
} from '../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'
import type { RetentionAcceptanceApp } from './retention-acceptance-app'

export function retentionAcceptanceSubject(app: RetentionAcceptanceApp, path: FilesystemPath) {
  const state = app.read()
  const document = state.documents.getState().getLiveEditorDocument(fileDocumentKey(path))
  if (!document)
    throw createClientInvariantError('Retention acceptance canonical document is unavailable')
  const configuration = editorPreparedDocumentTags(
    path,
    {
      appliedThemeContentHash: state.theme.appliedThemeContentHash,
      appliedThemeId: state.theme.appliedThemeId,
      selectedThemeId: state.theme.selectedThemeId,
      syntaxHighlightingEnabled: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
    },
    true,
  ).highlighterConfigurationTag
  return {
    document,
    configuration,
    identity: {
      document: document.analysis.documentId,
      revision: document.buffer.getRevision(),
      configuration: JSON.stringify(configuration),
      paintedGeneration: 'unknown' as const,
    },
  }
}

export function retentionAcceptanceReference(
  app: RetentionAcceptanceApp,
  path: FilesystemPath,
): TokenPaintReference {
  const subject = retentionAcceptanceSubject(app, path)
  const lease = subject.document.analysis.borrowHighlighter({
    provider: editorHighlighterProvider(),
    languageId: 'typescript',
    configurationTag: subject.configuration,
  })
  if (!lease)
    throw createClientInvariantError('Retention acceptance real highlighter is unavailable')
  try {
    const read = lease.read()
    expect(read.kind).toBe('ready')
    if (read.kind !== 'ready')
      throw createClientInvariantError('Retention acceptance real highlighter is unsettled')
    expect(read.revision).toBe(subject.identity.revision)
    const source = read.snapshot.materializeFullText()
    expect(source).toBe(subject.document.buffer.materializeFullText())
    return {
      identity: subject.identity,
      source,
      expected: 'colored',
      runs: resolveTokenPaintRuns({
        source,
        tokens: read.result.tokens.toTokens(),
        viewportSelector: '.editor-virtualized-viewport',
      }),
    }
  } finally {
    lease.dispose()
  }
}

export async function awaitRetentionAcceptanceReady(
  app: RetentionAcceptanceApp,
  path: FilesystemPath,
) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await expect
    .poll(
      () => {
        const subject = retentionAcceptanceSubject(app, path)
        const lease = subject.document.analysis.borrowHighlighter({
          provider: editorHighlighterProvider(),
          languageId: 'typescript',
          configurationTag: subject.configuration,
        })
        if (!lease) return false
        try {
          const read = lease.read()
          return read.kind === 'ready' && read.revision === subject.document.buffer.getRevision()
        } finally {
          lease.dispose()
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

export function captureRetentionAcceptancePaint(
  app: RetentionAcceptanceApp,
  path: FilesystemPath,
  tab: TabId,
) {
  const groups = allEditorGroups(app.read().workspace.getState().workbenchPanels.editorGroups)
  const group = groups.find((candidate) => candidate.selectedTabId === tab)
  if (!group) throw createClientInvariantError('Retention acceptance selected group is unavailable')
  const inspection = app.read().ui.getState().controllersByTabId.get(tab)?.getSnapshot()
  if (!inspection)
    throw createClientInvariantError('Retention acceptance mounted controller is unavailable')
  if (inspection.foldMarkers.length || inspection.visibleRows.some((row) => !row.firstWrapSegment))
    throw createClientInvariantError(
      'Retention acceptance folded or wrapped mapping needs independent calibration',
    )
  const subject = retentionAcceptanceSubject(app, path)
  const source = subject.document.buffer.materializeFullText()
  const selector = `[data-editor-group-id="${group.id}"]`
  const raw = captureTokenPaint({
    source,
    viewportSelector: `${selector} .editor-virtualized-viewport`,
    rowSelector: '.editor-virtualized-row',
    excludedLayers:
      '.editor-virtualized-selection-layer,.editor-virtualized-hidden-character-layer,.editor-virtualized-fold-placeholder,.editor-virtualized-gutter-row',
    highlightPrefix: 'editor-shared-token-',
  })
  const frame: TokenPaintObservation = {
    ...raw,
    window: sourceTokenPaintWindow({ source, geometryWindow: raw.window }),
    identity: {
      ...subject.identity,
      document: inspection.documentId,
      revision: inspection.documentSyncPoint.revision,
    },
  }
  const header = document.querySelector<HTMLElement>(
    `${selector} [data-editor-tab-id="${tab}"][aria-selected="true"]`,
  )
  return {
    frame,
    headerPath: header?.dataset.editorTabPath ?? null,
    tab,
    source,
    installed: {
      documentId: inspection.documentId,
      languageId: inspection.languageId,
      theme: inspection.theme,
      textVersion: inspection.textVersion,
      syncPoint: inspection.documentSyncPoint,
      syntaxStatus: inspection.syntaxStatus,
      configuredTheme: subject.configuration,
      paintedGeneration: 'unknown' as const,
    },
  }
}

export function assertRetentionAcceptancePaint(
  sample: ReturnType<typeof captureRetentionAcceptancePaint>,
  reference: TokenPaintReference,
  path: FilesystemPath,
) {
  expect(sample.headerPath).toBe(path)
  expect(tokenPaintMismatch(sample.frame, reference)).toBeNull()
  const incomplete = { ...sample.frame, runs: sample.frame.runs.slice(1) }
  expect(tokenPaintMismatch(incomplete, reference)).not.toBeNull()
}
