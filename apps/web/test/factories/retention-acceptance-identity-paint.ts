import { expect } from 'vitest'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import {
  editorSyntaxColors,
  EDITOR_THEME_SOURCE,
} from '@/features/editor/state/syntax-highlighting'
import { languageIdForFilePath } from '@/lib/file-language'
import { highlightingService } from '@/lib/highlighting/state/service'
import { themeRegistrationQueryOptions } from '@/lib/code-theme/state/registration-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { RetentionAcceptanceApp } from './retention-acceptance-app'
import {
  retentionAcceptanceSubject,
  captureRetentionAcceptancePaint,
} from './retention-acceptance-paint'
import type { RetentionAcceptanceReference } from './retention-acceptance-projection'
import {
  resolveTokenPaintRuns,
  tokenPaintMismatch,
} from '../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'

export function retentionIdentityInput(app: RetentionAcceptanceApp, path: FilesystemPath) {
  const subject = retentionAcceptanceSubject(app, path)
  const theme = app.read().theme
  const enabled = readSettingsMirror()['editor.syntaxHighlighting.enabled']
  const languageId = languageIdForFilePath(path)
  const tags = editorPreparedDocumentTags(
    path,
    {
      appliedThemeContentHash: theme.appliedThemeContentHash,
      appliedThemeId: theme.appliedThemeId,
      selectedThemeId: theme.selectedThemeId,
      syntaxHighlightingEnabled: enabled,
    },
    true,
  )
  const colors = editorSyntaxColors(theme.selectedThemeId, languageId)
  const backend = highlightingService().documentBackend(EDITOR_THEME_SOURCE)
  return {
    identity: { ...subject.identity, document: subject.document.key, configuration: 'unknown' },
    analysisDocumentId: subject.document.analysis.documentId,
    source: subject.document.buffer.materializeFullText(),
    configuredOwner: {
      configuration: JSON.stringify(tags.highlighterConfigurationTag),
      languageId,
      theme: theme.editorTheme,
    },
    selectedThemeId: theme.selectedThemeId,
    appliedThemeId: theme.appliedThemeId,
    enabled,
    colors,
    tags,
    configuredBackend: backend.kind,
    retention: subject.document.analysis.inspectRetention(),
  }
}

export async function retentionIdentityReference(
  input: ReturnType<typeof retentionIdentityInput>,
): Promise<RetentionAcceptanceReference> {
  if (!input.enabled) return { ...input, expected: 'plain', runs: [] }
  const language = input.configuredOwner.languageId ?? 'text'
  const theme =
    input.colors === 'vscode'
      ? {
          format: 'vscode' as const,
          definition: (
            await resourceQueryClient.query(
              themeRegistrationQueryOptions(input.appliedThemeId ?? input.selectedThemeId),
            )
          ).registration,
        }
      : { format: 'editor' as const, definition: input.configuredOwner.theme }
  const result = await highlightingService().highlight(input.source, { language, theme })
  return {
    identity: input.identity,
    source: input.source,
    configuredOwner: input.configuredOwner,
    expected: 'colored',
    runs: resolveTokenPaintRuns({
      source: input.source,
      tokens: result.tokens,
      viewportSelector: '.editor-virtualized-viewport',
    }),
  }
}

export function calibrateRetentionIdentityOracle(
  sample: ReturnType<typeof captureRetentionAcceptancePaint>,
  reference: RetentionAcceptanceReference,
) {
  expect(tokenPaintMismatch(sample.frame, reference)).toBeNull()
  const controls = {
    stale: { ...reference, identity: { ...reference.identity, revision: -1 } },
    empty: { ...reference, runs: [] },
    missing: { ...reference, runs: reference.runs.slice(1) },
    wrongCurrent: {
      ...reference,
      runs: reference.runs.map((run) => ({
        ...run,
        style: { ...run.style, color: 'rgb(1, 2, 3)' },
      })),
    },
  }
  for (const control of Object.values(controls))
    expect(tokenPaintMismatch(sample.frame, control)).not.toBeNull()
  expect(tokenPaintMismatch({ ...sample.frame, rows: [] }, reference)).not.toBeNull()
  return controls
}
