import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import type {
  EditorPluginContext,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
  VirtualizedTextHighlightStyle,
} from '@singapor/core'
import type { SettingsLayerFile } from '@workspace/contracts'

import { createSettingsDiagnosticsPlugin } from '@/features/settings/state/diagnostics-plugin'
import {
  createSettingsDiagnosticsSource,
  type SettingsDiagnosticsSource,
} from '@/features/settings/state/diagnostics-source'
import { settingsEditorDiagnostics } from '@/features/settings/utils/diagnostics'

import { languageServerSnapshot } from '../../../../test/factories/language-server-snapshot'
import { expect, test } from '../../../../test/fixtures'

type HighlightCall = {
  readonly name: string
  readonly ranges: readonly { readonly start: number; readonly end: number }[]
  readonly style: VirtualizedTextHighlightStyle
}

type DiagnosticsHost = {
  readonly context: EditorViewContributionContext
  readonly highlights: HighlightCall[]
  readonly cleared: string[]
  setDocument(documentId: string, text: string): void
}

const USER_ID = documentKey(settingsJsonDocument('user'))
const WORKSPACE_ID = documentKey(settingsJsonDocument('workspace'))

test('renders diagnostics on the initial matching settings document', () => {
  const text = '{\n  "unknown.key": true\n}\n'
  const source = userSource(settingsFile(text, 'unknown.key'))
  const host = diagnosticsHost(USER_ID, text)
  const contribution = activate(source, host)

  contribution.update(host.context.getSnapshot(), 'document')

  expect(lastSeverityRanges(host, 'warning')).toEqual([
    { start: text.indexOf('"unknown.key"'), end: text.indexOf('"unknown.key"') + 13 },
  ])
})

test('updates diagnostics when the settings snapshot changes', () => {
  const before = '{ "unknown.key": true }'
  const after = '{\n  "other.unknown": true\n}'
  const source = userSource(settingsFile(before, 'unknown.key'))
  const host = diagnosticsHost(USER_ID, before)
  const contribution = activate(source, host)
  contribution.update(host.context.getSnapshot(), 'document')

  host.setDocument(USER_ID, after)
  source.setSnapshot({
    diagnostics: [unknownDiagnostic('other.unknown', 'user')],
    file: settingsFile(after, 'other.unknown'),
    target: 'user',
  })

  expect(lastSeverityRanges(host, 'warning')).toEqual([
    { start: after.indexOf('"other.unknown"'), end: after.indexOf('"other.unknown"') + 15 },
  ])
})

test('clears markers when the current snapshot has no diagnostics', () => {
  const text = '{ "unknown.key": true }'
  const file = settingsFile(text, 'unknown.key')
  const source = userSource(file)
  const host = diagnosticsHost(USER_ID, text)
  const contribution = activate(source, host)
  contribution.update(host.context.getSnapshot(), 'document')

  source.setSnapshot({ diagnostics: [], file, target: 'user' })

  expect(lastSeverityRanges(host, 'warning')).toEqual([])
})

test('clears the old document before rendering diagnostics for another scope', () => {
  const userText = '{ "unknown.key": true }'
  const workspaceText = '{ "workspace.unknown": true }'
  const source = userSource(settingsFile(userText, 'unknown.key'))
  const host = diagnosticsHost(USER_ID, userText)
  const contribution = activate(source, host)
  contribution.update(host.context.getSnapshot(), 'document')

  source.setSnapshot({
    diagnostics: [unknownDiagnostic('workspace.unknown', 'workspace')],
    file: settingsFile(workspaceText, 'workspace.unknown'),
    target: 'workspace',
  })
  expect(host.cleared).toContain('test-settings-diagnostics-warning')

  host.setDocument(WORKSPACE_ID, workspaceText)
  contribution.update(host.context.getSnapshot(), 'document')

  expect(lastSeverityRanges(host, 'warning')).toEqual([
    {
      start: workspaceText.indexOf('"workspace.unknown"'),
      end: workspaceText.indexOf('"workspace.unknown"') + 19,
    },
  ])
})

test('cleanup clears editor markers and unsubscribes from settings updates', () => {
  const text = '{ "unknown.key": true }'
  const source = userSource(settingsFile(text, 'unknown.key'))
  const host = diagnosticsHost(USER_ID, text)
  const contribution = activate(source, host)
  contribution.update(host.context.getSnapshot(), 'document')
  const rendered = host.highlights.length

  contribution.dispose()
  source.setSnapshot({ diagnostics: [], file: settingsFile('{}'), target: 'user' })

  expect(host.cleared).toEqual([
    'test-settings-diagnostics-error',
    'test-settings-diagnostics-warning',
    'test-settings-diagnostics-information',
    'test-settings-diagnostics-hint',
  ])
  expect(host.highlights).toHaveLength(rendered)
})

test('a malformed document renders parse errors instead of last-good value diagnostics', () => {
  const text = '{ "unknown.key" }'
  const file: SettingsLayerFile = {
    keyRanges: { 'unknown.key': keyRange(text, 'unknown.key') },
    parseErrors: [{ length: 1, message: 'ColonExpected', offset: text.length - 1 }],
    revision: 'broken',
    text,
  }

  expect(
    settingsEditorDiagnostics('user', file, [unknownDiagnostic('unknown.key', 'user')]),
  ).toEqual([
    expect.objectContaining({ code: 'parse-error', message: 'ColonExpected', severity: 1 }),
  ])
})

function activate(
  source: SettingsDiagnosticsSource,
  host: DiagnosticsHost,
): EditorViewContribution {
  let provider: EditorViewContributionProvider | null = null
  createSettingsDiagnosticsPlugin(source).activate({
    registerViewContribution: (registered) => {
      provider = registered
      return { dispose: () => undefined }
    },
  } as EditorPluginContext)

  expect(provider).not.toBeNull()
  return provider!.createContribution(host.context)!
}

function diagnosticsHost(documentId: string, text: string): DiagnosticsHost {
  let snapshot = editorSnapshot(documentId, text)
  const highlights: HighlightCall[] = []
  const cleared: string[] = []
  const context = {
    clearRangeHighlight: (name: string) => {
      cleared.push(name)
    },
    getFeature: () => null,
    getSnapshot: () => snapshot,
    highlightPrefix: 'test',
    setRangeHighlight: (
      name: string,
      ranges: HighlightCall['ranges'],
      style: VirtualizedTextHighlightStyle,
    ) => {
      highlights.push({ name, ranges, style })
    },
  } as unknown as EditorViewContributionContext

  return {
    cleared,
    context,
    highlights,
    setDocument: (nextId, nextText) => {
      snapshot = editorSnapshot(nextId, nextText)
    },
  }
}

function editorSnapshot(documentId: string, fullText: string): EditorViewSnapshot {
  return languageServerSnapshot(documentId, 'json', fullText)
}

function userSource(file: SettingsLayerFile): SettingsDiagnosticsSource {
  return createSettingsDiagnosticsSource({
    diagnostics: [unknownDiagnostic('unknown.key', 'user')],
    file,
    target: 'user',
  })
}

function settingsFile(text: string, key?: string): SettingsLayerFile {
  return {
    keyRanges: key ? { [key]: keyRange(text, key) } : {},
    parseErrors: [],
    revision: 'revision',
    text,
  }
}

function keyRange(text: string, key: string) {
  const token = JSON.stringify(key)
  return { offset: text.indexOf(token), length: token.length }
}

function unknownDiagnostic(id: string, layer: 'user' | 'workspace') {
  return { id, kind: 'unknown-key' as const, layer }
}

function lastSeverityRanges(host: DiagnosticsHost, severity: string) {
  return host.highlights.findLast((call) => call.name.endsWith(`-${severity}`))?.ranges
}
