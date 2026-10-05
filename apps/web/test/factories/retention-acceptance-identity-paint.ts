import { expect } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { decodePaintSnapshot } from '../../../../editor/packages/editor/src/editor/paintSnapshot'
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
import { readLiveSettingsProjection } from '@/features/settings/state/live-projection'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import type { SettingsSnapshot } from '@workspace/contracts'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import type { RetentionAcceptanceApp } from './retention-acceptance-app'
import {
  retentionAcceptanceSubject,
  captureRetentionAcceptancePaint,
} from './retention-acceptance-paint'
import type { RetentionAcceptanceReference } from './retention-acceptance-projection'
import {
  resolveTokenPaintRuns,
  tokenPaintMismatch,
  sourceTokenPaintWindow,
  type TokenPaintObservation,
} from '../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'

export function retentionIdentityCaptureFrame(
  capture: ReturnType<Editor['captureSnapshot']> | undefined,
  source: string,
) {
  if (!capture) return { kind: 'absent' } as const
  const paint = decodePaintSnapshot(capture.paint)
  if (!paint || !paint.rows.length) return { kind: 'unsupported', paint: capture.paint } as const
  const height = paint.rows[0]?.height ?? 0
  const lines = source.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const rows: TokenPaintObservation['rows'][number][] = []
  const runs: TokenPaintObservation['runs'][number][] = []
  for (const row of paint.rows) {
    const index = row.top / height
    const start = starts[index]
    const text = row.segments.map((segment) => segment.text).join('')
    if (
      !Number.isSafeInteger(index) ||
      start === undefined ||
      row.height !== height ||
      row.left !== 0 ||
      row.fold !== null ||
      row.segments.some((segment) => segment.kind !== 'text') ||
      text !== lines[index]
    )
      return { kind: 'unsupported', paint: capture.paint } as const
    rows.push({ start, end: start + text.length, text, mapping: 'source', presentation: 'live' })
    const tokens = []
    let end = start
    for (const segment of row.segments) {
      tokens.push({ start: end, end: end + segment.text.length, style: segment })
      end += segment.text.length
    }
    runs.push(...captureStyleRuns(source, tokens, row.color))
  }
  const frame: TokenPaintObservation = {
    at: performance.now(),
    identity: {
      document: capture.documentId,
      revision: capture.bufferRevision,
      configuration: 'unknown',
      paintedGeneration: 'unknown',
    },
    window: sourceTokenPaintWindow({
      source,
      geometryWindow: {
        start: Math.floor(paint.scrollTop / height),
        end: Math.ceil((paint.scrollTop + paint.viewportHeight) / height),
      },
    }),
    rows,
    runs,
  }
  return { kind: 'projected', paint: capture.paint, frame } as const
}

function captureStyleRuns(
  source: string,
  tokens: Parameters<typeof resolveTokenPaintRuns>[0]['tokens'],
  foreground: string,
) {
  const viewport = document.querySelector('.editor-virtualized-viewport')
  if (!viewport) return []
  const probe = document.createElement('div')
  probe.dataset.retentionIdentityCaptureProbe = ''
  probe.style.display = 'none'
  probe.style.color = foreground
  viewport.append(probe)
  try {
    return resolveTokenPaintRuns({
      source,
      tokens,
      viewportSelector: '[data-retention-identity-capture-probe]',
    })
  } finally {
    probe.remove()
  }
}

export function assertRetentionIdentityCapture(
  capture: unknown,
  projection: ReturnType<typeof retentionIdentityCaptureFrame>,
  sample: ReturnType<typeof captureRetentionAcceptancePaint>,
  reference: RetentionAcceptanceReference,
) {
  if (
    !capture ||
    typeof capture !== 'object' ||
    !('paint' in capture) ||
    typeof capture.paint !== 'string' ||
    !('documentId' in capture) ||
    !('bufferRevision' in capture) ||
    !('textVersion' in capture)
  )
    throw createClientInvariantError('Current identity frame has no supported public capture')
  expect(capture.documentId).toBe(reference.identity.document)
  expect(capture.bufferRevision).toBe(reference.identity.revision)
  expect(capture.textVersion).toBe(sample.installed.editorTextVersion)
  expect(projection.kind).toBe('projected')
  if (projection.kind !== 'projected') return
  expect(projection.paint).toBe(capture.paint)
  expect(projection.frame.identity.document).toBe(capture.documentId)
  expect(projection.frame.identity.revision).toBe(capture.bufferRevision)
  expect(projection.frame.window).toEqual(sample.frame.window)
  expect(tokenPaintMismatch(projection.frame, reference)).toBeNull()
}

export function retentionIdentityInput(app: RetentionAcceptanceApp, path: FilesystemPath) {
  const subject = retentionAcceptanceSubject(app, path)
  const theme = app.read().theme
  const projection = readLiveSettingsProjection(app.queryClient)
  const confirmed = app.queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())
  const enabled =
    projection?.values['editor.syntaxHighlighting.enabled'] ??
    readSettingsMirror()['editor.syntaxHighlighting.enabled']
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
  const colors = enabled ? editorSyntaxColors(theme.selectedThemeId, languageId) : 'disabled'
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
    syntaxSettingInput: {
      authority: projection ? 'live-projection' : 'boot-mirror',
      effective: enabled,
      confirmed: confirmed?.values['editor.syntaxHighlighting.enabled'] ?? null,
      bootMirror: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
      pendingMutationIds: projection?.pendingMutationIds ?? [],
    },
    colors,
    tags,
    configuredBackend: backend.kind,
    retention: subject.document.analysis.inspectRetention(),
  }
}

export function captureRetentionIdentityPaint(
  app: RetentionAcceptanceApp,
  path: FilesystemPath,
  tab: TabId,
) {
  const sample = captureRetentionAcceptancePaint(app, path, tab)
  const input = retentionIdentityInput(app, path)
  return {
    ...sample,
    installed: {
      ...sample.installed,
      configuredProviderConfiguration: input.configuredOwner.configuration,
      configuredTheme: input.tags.highlighterConfigurationTag,
    },
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
