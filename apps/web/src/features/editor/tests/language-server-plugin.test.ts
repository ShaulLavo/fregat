import {
  LanguageServerDocumentSyncController,
  summarizeDiagnostics,
  type LanguageServerSetPluginOptions,
} from '@singapor/lsp-plugin'
import { beforeEach, describe, vi } from 'vitest'

import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { expect, test } from '../../../../test/fixtures'

const { createdServerSets } = vi.hoisted(() => ({
  createdServerSets: [] as LanguageServerSetPluginOptions[],
}))

vi.mock('@singapor/lsp-plugin/websocket', () => ({
  createLanguageServerSetPlugin: (options: LanguageServerSetPluginOptions) => {
    createdServerSets.push(options)
    return { activate: () => [], name: 'editor.language-server' }
  },
}))

const { createMatchedLanguageServerPlugin, languageServerMatches } =
  await import('@/features/editor/utils/language-server-plugin')

const onApplyWorkspaceEdit = vi.fn(async () => ({ status: 'applied' as const }))
const documentSyncController = new LanguageServerDocumentSyncController()

beforeEach(() => {
  createdServerSets.length = 0
})

describe('createMatchedLanguageServerPlugin', () => {
  test('stays idle without eligible matches', () => {
    const source = createEditorLanguageServerStatusSource()
    const plugin = createMatchedLanguageServerPlugin({
      documentSyncController,
      enabled: true,
      matches: [],
      rootPath: '/repo',
      statusSource: source,
      target: { matchPath: '/repo/README.md' },
      onApplyWorkspaceEdit,
    })

    plugin.activate({} as never)

    expect(plugin.name).toBe('editor.language-server.idle')
    expect(source.getSnapshot().status).toBe('idle')
    expect(createdServerSets).toEqual([])
  })

  test('builds one composite with one distinct lane per descriptor', () => {
    const source = createEditorLanguageServerStatusSource()
    const onDefinitionLinkHover = vi.fn()
    const onDidNavigateDiagnostic = vi.fn(() => ({ kind: 'ignored' as const }))
    const plugin = createMatchedLanguageServerPlugin({
      documentSyncController,
      enabled: true,
      matches: [match('typescript', '/repo/package', 0), match('eslint', '/repo', 5)],
      rootPath: '/repo',
      statusSource: source,
      target: { matchPath: 'src/a.ts' },
      onApplyWorkspaceEdit,
      onDefinitionLinkHover,
      onDidNavigateDiagnostic,
    })

    plugin.activate({} as never)
    const options = createdServerSets[0]
    const routes = options?.lanes.map((lane) => new URL(lane.webSocketRoute)) ?? []

    expect(createdServerSets).toHaveLength(1)
    expect(options?.lanes.map((lane) => lane.id)).toEqual(['typescript', 'eslint'])
    expect(options?.onApplyWorkspaceEdit).toBe(onApplyWorkspaceEdit)
    expect(options?.onDefinitionLinkHover).toBe(onDefinitionLinkHover)
    expect(options?.onDidNavigateDiagnostic).toBe(onDidNavigateDiagnostic)
    expect(options?.lanes.every((lane) => lane.onApplyWorkspaceEdit === onApplyWorkspaceEdit)).toBe(
      true,
    )
    expect(options?.lanes[0]?.connectionProvider).not.toBe(options?.lanes[1]?.connectionProvider)
    expect(options?.lanes.map((lane) => lane.rootUri)).toEqual([
      'file:///repo/package',
      'file:///repo',
    ])
    expect(routes.map((route) => route.searchParams.get('server'))).toEqual([
      'typescript',
      'eslint',
    ])
    expect(routes.every((route) => route.searchParams.get('path') === 'src/a.ts')).toBe(true)
    expect(source.getSnapshot().status).toBe('loading')
  })

  test('applies feature exclusions and named ready notifications before lane construction', () => {
    createMatchedLanguageServerPlugin({
      documentSyncController,
      enabled: true,
      matches: [match('typescript', '/repo', 0), match('eslint', '/repo', 5)],
      rootPath: '/repo',
      statusSource: createEditorLanguageServerStatusSource(),
      target: {
        matchPath: '.platform/settings.json',
        disabledFeatures: ['diagnostics'],
        sharedNotificationsByServer: {
          typescript: [{ method: 'workspace/state', params: { complete: true } }],
        },
      },
      onApplyWorkspaceEdit,
    })

    const [typescript, eslint] = createdServerSets[0]?.lanes ?? []
    expect(typescript?.features.diagnostics).toBeUndefined()
    expect(eslint?.features.diagnostics).toBeUndefined()
    expect(typescript?.readyNotifications).toEqual([
      { method: 'workspace/state', params: { complete: true } },
    ])
    expect(eslint?.readyNotifications).toBeUndefined()
  })

  test('keeps a ready primary aggregate ready when a secondary errors', () => {
    const source = createEditorLanguageServerStatusSource()
    const plugin = createMatchedLanguageServerPlugin({
      documentSyncController,
      enabled: true,
      matches: [match('typescript', '/repo', 0), match('eslint', '/repo', 5)],
      rootPath: '/repo',
      statusSource: source,
      target: { matchPath: 'src/a.ts' },
      onApplyWorkspaceEdit,
    })
    plugin.activate({} as never)
    const [typescript, eslint] = createdServerSets[0]?.lanes ?? []

    typescript?.onStatusChange?.('ready')
    typescript?.onInteractiveReady?.()
    eslint?.onStatusChange?.('error')

    expect(source.getSnapshot().status).toBe('ready')
  })

  test('keeps a lane ready after a routed request fails', () => {
    const source = createEditorLanguageServerStatusSource()
    const plugin = createMatchedLanguageServerPlugin({
      documentSyncController,
      enabled: true,
      matches: [match('typescript', '/repo', 0)],
      rootPath: '/repo',
      statusSource: source,
      target: { matchPath: 'src/a.ts' },
      onApplyWorkspaceEdit,
    })
    plugin.activate({} as never)
    const lane = createdServerSets[0]?.lanes[0]

    lane?.onStatusChange?.('ready')
    lane?.onInteractiveReady?.()
    expect(source.getSnapshot().status).toBe('ready')

    lane?.onRequestError?.('textDocument/hover', new Error('request failed'))
    expect(source.getSnapshot().status).toBe('ready')

    lane?.onError?.(new Error('transport failed'))
    expect(source.getSnapshot().status).toBe('error')
  })

  test('orders composite diagnostics by diagnostic rank', () => {
    const source = createEditorLanguageServerStatusSource()
    const plugin = createMatchedLanguageServerPlugin({
      documentSyncController,
      enabled: true,
      matches: [match('typescript', '/repo', 5), match('eslint', '/repo', 0)],
      rootPath: '/repo',
      statusSource: source,
      target: { matchPath: 'src/a.ts' },
      onApplyWorkspaceEdit,
    })
    plugin.activate({} as never)
    const [typescript, eslint] = createdServerSets[0]?.lanes ?? []

    typescript?.onDiagnostics?.(diagnostics('typescript'))
    eslint?.onDiagnostics?.(diagnostics('eslint'))

    expect(source.getSnapshot().diagnostics?.diagnostics.map((item) => item.message)).toEqual([
      'eslint',
      'typescript',
    ])
  })
})

describe('semantic token ownership', () => {
  test('creates layer options for the runtime-elected semantic owner', () => {
    createMatchedLanguageServerPlugin({
      documentSyncController,
      enabled: true,
      matches: [match('typescript', '/repo', 5), match('rust', '/repo', 0)],
      rootPath: '/repo',
      statusSource: createEditorLanguageServerStatusSource(),
      target: { matchPath: 'src/a.rs' },
      onApplyWorkspaceEdit,
    })

    const options = createdServerSets[0]
    const semanticTokens = options?.semanticTokens?.({
      id: 'rust',
      connection: { client: {}, workspace: {} } as never,
    })

    expect(semanticTokens?.viewportDelayMs).toBe(0)
    expect(options?.lanes.every((lane) => lane.onConnectionCreated === undefined)).toBe(true)
    semanticTokens?.dispose?.()
  })

  test('keeps initialization capabilities stable per server', () => {
    for (const root of ['/repo', '/other']) {
      createMatchedLanguageServerPlugin({
        documentSyncController,
        enabled: true,
        matches: [match('rust', root, 0)],
        rootPath: root,
        statusSource: createEditorLanguageServerStatusSource(),
        target: { matchPath: 'src/a.rs' },
        onApplyWorkspaceEdit,
      })
    }

    const [first, second] = createdServerSets.map((set) => set.lanes[0]?.capabilities)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first).toMatchObject({ workspace: { semanticTokens: { refreshSupport: true } } })
  })
})

describe('languageServerMatches', () => {
  test('normalizes valid collection responses and rejects malformed descriptors', () => {
    expect(
      languageServerMatches([
        { root: '/repo', serverId: 'typescript', features: { completion: 0 } },
        { root: '/repo', serverId: 'bad', features: { unknown: 0 } },
      ]),
    ).toEqual([{ root: '/repo', serverId: 'typescript', features: { completion: 0 } }])
    expect(languageServerMatches(null)).toEqual([])
    expect(languageServerMatches([{ root: 1, serverId: 'typescript', features: {} }])).toEqual([])
  })
})

function match(serverId: string, root: string, semanticRank: number) {
  return {
    root,
    serverId,
    features: {
      completion: semanticRank,
      diagnostics: semanticRank,
      hover: semanticRank,
      navigation: semanticRank,
      semanticTokens: semanticRank,
    },
  }
}

function diagnostics(message: string) {
  return summarizeDiagnostics('file:///repo/src/a.ts', 1, [
    {
      message,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: 1,
    },
  ])
}
