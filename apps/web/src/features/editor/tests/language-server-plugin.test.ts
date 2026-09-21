import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'
import { LanguageServerDocumentSyncController } from '@singapore-editor/lsp-plugin/document-sync-controller'
import { type LanguageServerSetPluginOptions } from '@singapore-editor/lsp-plugin/websocket'
import { beforeEach, describe, vi } from 'vitest'
import { activeDocumentForSnapshot } from '@singapore-editor/lsp-plugin/document-sync'

import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import {
  fileDocument,
  fileResource,
  filesystemPath,
  settingsJsonDocument,
} from '@/lib/documents/utils/identity'
import { languageServerDocument } from '@/lib/language-server-document'
import { languageServerSnapshot } from '../../../../test/factories/language-server-snapshot'
import { expect, test } from '../../../../test/fixtures'

const { createdServerSets } = vi.hoisted(() => ({
  createdServerSets: [] as LanguageServerSetPluginOptions[],
}))

vi.mock('@singapore-editor/lsp-plugin/websocket', () => ({
  createLanguageServerSetPlugin: (options: LanguageServerSetPluginOptions) => {
    createdServerSets.push(options)
    return { activate: () => [], name: 'editor.language-server' }
  },
}))

const { createMatchedLanguageServerPlugin, languageServerMatches } =
  await import('@/features/editor/utils/language-server-plugin')

const onApplyWorkspaceEdit = vi.fn(async () => ({ status: 'applied' as const }))
const documentSyncController = new LanguageServerDocumentSyncController()
const document = languageServerDocument(fileDocument(fileResource(filesystemPath('src/a.ts'))))

beforeEach(() => {
  createdServerSets.length = 0
})

describe('createMatchedLanguageServerPlugin', () => {
  test.each([
    {
      target: fileDocument(fileResource(filesystemPath('settings-json:app.tsx'))),
      uri: 'file:///settings-json%3Aapp.tsx',
      languageId: 'typescript',
      expectedLanguage: 'typescriptreact',
    },
    {
      target: fileDocument(fileResource(filesystemPath('src/app.tsx'))),
      uri: 'file:///src/app.tsx',
      languageId: 'typescript',
      expectedLanguage: 'typescriptreact',
    },
    {
      target: fileDocument(fileResource(filesystemPath('/repo/a [b] #1.tsx'))),
      uri: 'file:///repo/a%20%5Bb%5D%20%231.tsx',
      languageId: 'typescript',
      expectedLanguage: 'typescriptreact',
    },
    {
      target: settingsJsonDocument('user'),
      uri: 'settings-json:user',
      languageId: 'json',
      expectedLanguage: 'json',
    },
    {
      target: settingsJsonDocument('workspace'),
      uri: 'settings-json:workspace',
      languageId: 'json',
      expectedLanguage: 'json',
    },
  ] as const)(
    'syncs $uri independently of the native document key',
    ({ target, uri, languageId, expectedLanguage }) => {
      const document = languageServerDocument(target)
      if (!document) return expect.unreachable('Expected an LSP document')
      createMatchedLanguageServerPlugin({
        origin: 'http://localhost:3001',
        document,
        documentSyncController,
        enabled: true,
        matches: [match('typescript', '/repo', 0)],
        rootPath: '/repo',
        statusSource: createEditorLanguageServerStatusSource(),
        target: { matchPath: 'src/app.tsx' },
        onApplyWorkspaceEdit,
      })
      const snapshot = languageServerSnapshot(document.key, languageId)
      const options = createdServerSets[0]?.documentSync ?? {}
      const active = activeDocumentForSnapshot(snapshot, options)

      expect(active?.uri).toBe(uri)
      expect(active?.languageId).toBe(expectedLanguage)
      expect(snapshot.documentId).toBe(document.key)
      expect(
        activeDocumentForSnapshot(languageServerSnapshot('outgoing-document'), options),
      ).toBeNull()
    },
  )

  test('stays idle without eligible matches', () => {
    const source = createEditorLanguageServerStatusSource()
    const plugin = createMatchedLanguageServerPlugin({
      origin: 'http://localhost:3001',
      document,
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

  test('stays idle when a view has no language-server document', () => {
    const source = createEditorLanguageServerStatusSource()
    const plugin = createMatchedLanguageServerPlugin({
      origin: 'http://localhost:3001',
      document: languageServerDocument({ kind: 'search', root: filesystemPath('/repo') }),
      documentSyncController,
      enabled: true,
      matches: [match('typescript', '/repo', 0)],
      rootPath: '/repo',
      statusSource: source,
      target: { matchPath: 'src/a.ts' },
      onApplyWorkspaceEdit,
    })

    expect(plugin.name).toBe('editor.language-server.idle')
    expect(createdServerSets).toEqual([])
  })

  test('builds one composite with one distinct lane per descriptor', () => {
    const source = createEditorLanguageServerStatusSource()
    const onDefinitionLinkHover = vi.fn()
    const onDidNavigateDiagnostic = vi.fn(() => ({ kind: 'ignored' as const }))
    const plugin = createMatchedLanguageServerPlugin({
      origin: 'http://localhost:3001',
      document,
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
      origin: 'http://localhost:3001',
      document,
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
      origin: 'http://localhost:3001',
      document,
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
      origin: 'http://localhost:3001',
      document,
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
      origin: 'http://localhost:3001',
      document,
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
      origin: 'http://localhost:3001',
      document,
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
        origin: 'http://localhost:3001',
        document,
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
