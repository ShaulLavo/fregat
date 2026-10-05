import {
  captureTokenPaint,
  resolveTokenPaintRuns,
  sourceTokenPaintWindow,
  tokenPaintMismatch,
} from '../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'
import { allEditorGroups } from '@/lib/documents/utils/groups'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import { retentionAcceptanceOwnerMismatch } from './retention-acceptance-projection'
import { languageIdForFilePath } from '@/lib/file-language'
import { editorHighlighterProvider } from '@/features/editor/state/syntax-highlighting'

export function captureRetentionAcceptanceEntry() {
  const owner = window.__retentionAcceptanceEntry
  if (!owner) return { kind: 'unmounted' } as const
  const groups = allEditorGroups(owner.workspace.getState().workbenchPanels.editorGroups)
  return {
    kind: 'mounted',
    views: groups.map((group) => {
      const tab = group.tabs.find((candidate) => candidate.id === group.selectedTabId)
      const view = tab ? owner.documents.getState().viewsByTabId[tab.id] : null
      const controller = tab ? owner.ui.getState().controllersByTabId.get(tab.id) : null
      const snapshot = controller?.getSnapshot()
      const canonical = view
        ? owner.documents.getState().getLiveEditorDocument(view.documentKey)
        : null
      const path = tab ? tabFileResource(tab.content)?.path : null
      if (!tab || !snapshot || !canonical || !path)
        return { kind: 'unready', groupId: group.id } as const
      const source = canonical.buffer.materializeFullText()
      const configuration = editorPreparedDocumentTags(
        path,
        {
          selectedThemeId: owner.theme.selectedThemeId,
          appliedThemeId: owner.theme.appliedThemeId,
          appliedThemeContentHash: owner.theme.appliedThemeContentHash,
          syntaxHighlightingEnabled: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
        },
        true,
      ).highlighterConfigurationTag
      const identity = {
        document: snapshot.documentId,
        revision: snapshot.documentSyncPoint.revision,
        configuration: 'unknown',
        paintedGeneration: 'unknown' as const,
      }
      const selector = `[data-editor-group-id="${group.id}"]`
      const viewportSelector = `${selector} .editor-virtualized-viewport`
      const headerPath =
        document.querySelector<HTMLElement>(
          `${selector} [data-editor-tab-id="${tab.id}"][aria-selected="true"]`,
        )?.dataset.editorTabPath ?? null
      const raw = captureTokenPaint({
        source,
        viewportSelector,
        rowSelector: '.editor-virtualized-row',
        excludedLayers:
          '.editor-virtualized-selection-layer,.editor-virtualized-hidden-character-layer,.editor-virtualized-fold-placeholder,.editor-virtualized-gutter-row',
        highlightPrefix: 'editor-shared-token-',
      })
      const frame = {
        ...raw,
        window: sourceTokenPaintWindow({ source, geometryWindow: raw.window }),
        identity,
      }
      const unsupported =
        snapshot.foldMarkers.length > 0 || snapshot.visibleRows.some((row) => !row.firstWrapSegment)
      if (unsupported)
        return {
          kind: 'unsupported',
          path,
          headerPath,
          frame,
          why: 'projection requires calibrated metadata adapter',
        } as const
      if (snapshot.paintLayers === null || !['ready', 'plain'].includes(snapshot.syntaxStatus))
        return {
          kind: 'unready',
          path,
          headerPath,
          frame,
          source,
          currentIdentity: {
            ...identity,
            document: canonical.analysis.documentId,
            revision: canonical.buffer.getRevision(),
          },
          syntaxStatus: snapshot.syntaxStatus,
          initialHighlightStatus: snapshot.initialHighlightStatus,
          paintLayers: snapshot.paintLayers,
        } as const
      const configuredOwner = {
        configuration: JSON.stringify(configuration),
        languageId: languageIdForFilePath(path),
        theme: owner.theme.editorTheme,
      }
      if (snapshot.syntaxStatus === 'plain') {
        const reference = {
          identity: {
            ...identity,
            document: canonical.analysis.documentId,
            revision: canonical.buffer.getRevision(),
          },
          source,
          configuredOwner,
          runs: [],
          expected: 'plain' as const,
        }
        return {
          kind: 'observed',
          path,
          headerPath,
          frame,
          reference,
          mismatch:
            snapshot.initialHighlightStatus !== 'plain'
              ? 'pending plain paint'
              : tokenPaintMismatch(frame, reference),
          metadata: snapshot.toVisibleSnapshot()?.toJSON() ?? null,
        } as const
      }
      if (snapshot.syntaxStatus !== 'ready')
        return { kind: 'unready', path, headerPath, frame } as const
      const lease = canonical.analysis.borrowHighlighter({
        provider: editorHighlighterProvider(),
        languageId: snapshot.languageId,
        configurationTag: configuration,
      })
      if (!lease) return { kind: 'unready', path, headerPath, frame } as const
      try {
        const read = lease.read()
        if (read.kind !== 'ready' || read.revision !== canonical.buffer.getRevision())
          return { kind: 'unready', path, headerPath, frame } as const
        const reference = {
          identity: {
            ...identity,
            document: canonical.analysis.documentId,
            revision: read.revision,
          },
          source: read.snapshot.materializeFullText(),
          runs: resolveTokenPaintRuns({
            source,
            tokens: read.result.tokens.toTokens(),
            viewportSelector,
          }),
          expected: 'colored' as const,
          configuredOwner,
        }
        return {
          kind: 'observed',
          path,
          headerPath,
          frame,
          reference,
          mismatch:
            retentionAcceptanceOwnerMismatch(
              {
                identity,
                configuredProviderConfiguration: configuredOwner.configuration,
                languageId: snapshot.languageId,
                theme: snapshot.theme,
                syntaxStatus: snapshot.syntaxStatus,
                initialHighlightStatus: snapshot.initialHighlightStatus,
                paintLayers: snapshot.paintLayers,
              },
              reference,
            ) ?? tokenPaintMismatch(frame, reference),
          metadata: snapshot.toVisibleSnapshot()?.toJSON() ?? null,
        } as const
      } finally {
        lease.dispose()
      }
    }),
  } as const
}
