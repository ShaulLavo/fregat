import { expect } from 'vitest'
import { editorHighlighterProvider } from '@/features/editor/state/syntax-highlighting'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import { allEditorGroups } from '@/lib/documents/utils/groups'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { projectSettings } from '@workspace/client-core/settings/projection'
import { settingsIntentStore } from '@workspace/client-core/settings/intent-store'
import type { SettingsSnapshot } from '@workspace/contracts'
import { createClientInvariantError } from '@/lib/structured-errors'
import {
  captureTokenPaint,
  resolveTokenPaintRuns,
  sourceTokenPaintWindow,
  tokenPaintMismatch,
  type TokenPaintObservation,
} from '../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'
import type { RetentionAcceptanceApp } from './retention-acceptance-app'
import { settingsSnapshot } from './settings'
import type { EditorViewSnapshot } from '@singapore-editor/core/editor'
import { languageIdForFilePath } from '@/lib/file-language'
import {
  retentionAcceptanceOwnerMismatch,
  type RetentionAcceptanceBinding,
  type RetentionAcceptanceReference,
} from './retention-acceptance-projection'

type RetentionPaintApp = {
  readonly read: () => Pick<
    ReturnType<RetentionAcceptanceApp['read']>,
    'documents' | 'theme' | 'ui' | 'workspace'
  >
}

export function retentionAcceptanceSubject(app: RetentionPaintApp, path: FilesystemPath) {
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
  app: RetentionPaintApp,
  path: FilesystemPath,
): RetentionAcceptanceReference {
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
      identity: { ...subject.identity, configuration: 'unknown' },
      configuredOwner: {
        configuration: JSON.stringify(subject.configuration),
        languageId: languageIdForFilePath(path),
        theme: app.read().theme.editorTheme,
      },
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

export function retentionAcceptanceBinding(
  app: RetentionPaintApp,
  path: FilesystemPath,
  snapshot: EditorViewSnapshot,
): RetentionAcceptanceBinding {
  const subject = retentionAcceptanceSubject(app, path)
  return {
    identity: {
      document: snapshot.documentId,
      revision: snapshot.documentSyncPoint.revision,
      configuration: 'unknown',
      paintedGeneration: 'unknown',
    },
    source: snapshot.textSnapshot.readRange(0, snapshot.textSnapshot.length),
    editorTextVersion: snapshot.textVersion,
    presentation: 'live',
    configuredProviderConfiguration: JSON.stringify(subject.configuration),
    installedProviderConfiguration: 'unknown',
    languageId: snapshot.languageId,
    theme: snapshot.theme,
    syntaxStatus: snapshot.syntaxStatus,
    initialHighlightStatus: snapshot.initialHighlightStatus,
    paintLayers: snapshot.paintLayers,
  }
}

export async function configureRetentionAcceptanceSyntax(
  app: RetentionAcceptanceApp,
  enabled: boolean,
) {
  await app.queryClient.cancelQueries({ queryKey: settingsKeys.document(), exact: true })
  app.queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({ values: { 'editor.syntaxHighlighting.enabled': enabled } }),
  )
  await expect
    .poll(() => {
      const snapshot = app.queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())
      const intents = settingsIntentStore
        .getState()
        .active.filter((entry) => entry.patch.owner === app.queryClient)
      return {
        confirmed: snapshot?.values['editor.syntaxHighlighting.enabled'],
        projected: snapshot
          ? projectSettings(snapshot, intents).values['editor.syntaxHighlighting.enabled']
          : undefined,
        mirror: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
      }
    })
    .toEqual({ confirmed: enabled, projected: enabled, mirror: enabled })
}

export type RetentionAcceptanceReadyDiagnostics = {
  last?: {
    sourceDocumentId: EditorViewSnapshot['documentId']
    sourceRevision: number
    sourceConfiguration: ReturnType<typeof retentionAcceptanceSubject>['configuration']
    mounted: readonly {
      documentId: EditorViewSnapshot['documentId'] | undefined
      revision: number | undefined
      syntaxStatus: EditorViewSnapshot['syntaxStatus'] | undefined
      initialHighlightStatus: EditorViewSnapshot['initialHighlightStatus'] | undefined
      paintAvailable: boolean
    }[]
    request: {
      languageId: string
      configurationTag: ReturnType<typeof retentionAcceptanceSubject>['configuration']
    } | null
    lease:
      | { kind: 'not-borrowed' | 'unavailable' | 'unread' }
      | { kind: 'pending' | 'ready' | 'failed'; revision: number }
    comparedRevision: number | null
  }
}

export async function awaitRetentionAcceptanceReady(
  app: RetentionPaintApp,
  path: FilesystemPath,
  diagnostics?: RetentionAcceptanceReadyDiagnostics,
) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await expect
    .poll(
      () => {
        const subject = retentionAcceptanceSubject(app, path)
        const mounted = [...app.read().ui.getState().controllersByTabId.values()]
          .map((controller) => controller.getSnapshot())
          .filter((snapshot) => snapshot?.documentId === subject.document.analysis.documentId)
        const revision = subject.document.buffer.getRevision()
        const poll: RetentionAcceptanceReadyDiagnostics['last'] = diagnostics
          ? {
              sourceDocumentId: subject.document.analysis.documentId,
              sourceRevision: revision,
              sourceConfiguration: subject.configuration,
              mounted: mounted.map((snapshot) => ({
                documentId: snapshot?.documentId,
                revision: snapshot?.documentSyncPoint.revision,
                syntaxStatus: snapshot?.syntaxStatus,
                initialHighlightStatus: snapshot?.initialHighlightStatus,
                paintAvailable: snapshot ? snapshot.paintLayers !== null : false,
              })),
              request: null,
              lease: { kind: 'not-borrowed' },
              comparedRevision: null,
            }
          : undefined
        if (diagnostics) diagnostics.last = poll
        if (
          mounted.length === 0 ||
          !mounted.every(
            (snapshot) =>
              snapshot?.documentSyncPoint.revision === revision &&
              snapshot.syntaxStatus === 'ready' &&
              snapshot.initialHighlightStatus === 'painted' &&
              snapshot.paintLayers !== null,
          )
        )
          return false
        const request = {
          provider: editorHighlighterProvider(),
          languageId: 'typescript',
          configurationTag: subject.configuration,
        }
        if (poll)
          poll.request = {
            languageId: request.languageId,
            configurationTag: request.configurationTag,
          }
        const lease = subject.document.analysis.borrowHighlighter(request)
        if (poll) poll.lease = { kind: lease ? 'unread' : 'unavailable' }
        if (!lease) return false
        let comparedRevision: number | null = null
        try {
          const read = lease.read()
          if (poll) poll.lease = { kind: read.kind, revision: read.revision }
          if (
            read.kind !== 'ready' ||
            read.revision !== (comparedRevision = subject.document.buffer.getRevision())
          )
            return false
          return true
        } finally {
          lease.dispose()
          if (poll) poll.comparedRevision = comparedRevision
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

export function captureRetentionAcceptancePaint(
  app: RetentionPaintApp,
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
  const binding = retentionAcceptanceBinding(app, path, inspection)
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
    identity: binding.identity,
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
      ...binding,
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
  reference: RetentionAcceptanceReference,
  path: FilesystemPath,
) {
  expect(sample.headerPath).toBe(path)
  expect(retentionAcceptanceOwnerMismatch(sample.installed, reference)).toBeNull()
  expect(sample.installed.source).toBe(reference.source)
  expect(tokenPaintMismatch(sample.frame, reference)).toBeNull()
  const incomplete = { ...sample.frame, runs: sample.frame.runs.slice(1) }
  expect(tokenPaintMismatch(incomplete, reference)).not.toBeNull()
}
