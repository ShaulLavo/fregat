import { jsonResponse as json } from '@/demo/utils/response'
import { bypass, http } from 'msw'
import * as v from 'valibot'
import {
  applySettingsOperations,
  clientOrchestrationCommandSchema,
  resolveSettings,
  settingsMutationRequestSchema,
  settingsSnapshotSchema,
} from '@workspace/contracts'
import {
  writeBodySchema,
  createFileBodySchema,
  createFolderBodySchema,
  renameBodySchema,
  copyBodySchema,
  deleteBodySchema,
} from '../../../../server/src/fs/contracts'
import { DEMO_ADDRESS, DEMO_ENVIRONMENT, DEMO_ROOT, seedProviders } from '../seed'
import { DemoWorkspace, demoError, type DemoChange } from '../state/workspace'
import { DemoOrchestration } from '../state/orchestration'
import { DEMO_SERVER_CONFIG } from './orchestration'
import { eventStream, finiteEvents } from './streams'
import { demoGitRequest } from './git'
import { searchFiles } from '../utils/search'

type DemoRequestRecord = { method: string; url: string; status: number; durationMs: number }
export type DemoDiagnostics = {
  requests: DemoRequestRecord[]
  unhandled: string[]
  logs: unknown[]
}
export type DemoAssets = { font: string; wallpaper: string }

export function demoHttpHandler(
  apiOrigin: string,
  workspace: DemoWorkspace,
  orchestration: DemoOrchestration,
  assets: DemoAssets,
  diagnostics: DemoDiagnostics,
) {
  return http.all(`${apiOrigin}/*`, ({ request }) =>
    respond(request, workspace, orchestration, assets, diagnostics),
  )
}

async function respond(
  request: Request,
  workspace: DemoWorkspace,
  orchestration: DemoOrchestration,
  assets: DemoAssets,
  diagnostics: DemoDiagnostics,
) {
  const started = performance.now()
  let response: Response
  try {
    if (new URL(request.url).pathname === '/_log/ingest') {
      diagnostics.logs.push(await request.json())
      if (diagnostics.logs.length > 200) diagnostics.logs.shift()
      response = json({ ok: true })
    } else response = await route(request, workspace, orchestration, assets)
  } catch (error) {
    const status = errorStatus(error)
    response = json(
      {
        error: {
          code: 'DEMO_REQUEST_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      },
      status,
    )
    if (status === 501) diagnostics.unhandled.push(`${request.method} ${request.url}`)
  }
  diagnostics.requests.push({
    method: request.method,
    url: request.url,
    status: response.status,
    durationMs: performance.now() - started,
  })
  if (diagnostics.requests.length > 500) diagnostics.requests.shift()
  return response
}

async function route(
  request: Request,
  workspace: DemoWorkspace,
  orchestration: DemoOrchestration,
  assets: DemoAssets,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/git/')) return demoGitRequest(url, request, workspace)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method === 'GET') return get(url, request.signal, workspace, orchestration, assets)
  if (request.method === 'POST') return post(url, request, workspace, orchestration)
  throw demoError(
    `Demo route not implemented: ${request.method} ${url.pathname}`,
    'DEMO_ROUTE',
    501,
  )
}

async function get(
  url: URL,
  signal: AbortSignal,
  workspace: DemoWorkspace,
  orchestration: DemoOrchestration,
  assets: DemoAssets,
): Promise<Response> {
  const path = url.searchParams.get('path') || DEMO_ROOT
  switch (url.pathname) {
    case '/health':
      return json({
        ok: true,
        environmentId: DEMO_ENVIRONMENT,
        label: 'garden demo',
        protocolVersion: DEMO_SERVER_CONFIG.protocolVersion,
        serverVersion: 'demo',
        platform: { os: 'linux', arch: 'browser' },
        workspaceRoot: DEMO_ROOT,
        systemRoot: '/',
        homePath: DEMO_ROOT,
        defaultPath: DEMO_ROOT,
        maxTextFileBytes: 4_194_304,
        workspaceIndex: indexStatus(workspace),
      })
    case '/settings':
      return json(workspace.settings)
    case '/settings/events':
      return eventStream(signal, (send) => {
        const publish = () =>
          send('settings', { snapshot: workspace.settings, changedSettingIds: [] })
        publish()
        workspace.updates.add(publish)
        return () => workspace.updates.delete(publish)
      })
    case '/settings/raw':
      return json(
        workspace.settings.layers.find(
          (layer) => layer.id === (url.searchParams.get('target') ?? 'user'),
        )?.file,
      )
    case '/themes/wallpapers':
      return json({ assets: [], omarchyAvailable: false })
    case '/themes/palettes':
      return json({ palettes: [] })
    case '/providers':
      return json({ providers: seedProviders() })
    case '/machines/ssh-hosts':
      return json({ hosts: [] })
    case '/machines/tailnet-hosts':
      return json({ hosts: [], available: false })
    case '/machines/events':
      return eventStream(signal, () => () => {})
    case '/wallpaper/info':
      return json({ kind: 'image', contentType: 'image/jpeg', source: 'still-image' })
    case '/wallpaper':
    case '/wallpaper/still':
      return fetch(bypass(assets.wallpaper))
    case '/fonts':
      return json([
        {
          ref: 'nerd:JetBrainsMono',
          family: 'JetBrainsMono Nerd Font',
          source: 'nerd',
          category: 'monospace',
          variable: false,
          weights: [400],
          license: null,
        },
      ])
    case '/fs/stat':
      return json(required(workspace.stat(path)))
    case '/fs/tree':
      return json(workspace.tree(path, Number(url.searchParams.get('depth') ?? 1)))
    case '/fs/read':
      return json(required(workspace.readFile(path)))
    case '/fs/blob':
      return new Response(required(workspace.readFile(path)).content, {
        headers: { 'content-type': 'text/plain' },
      })
    case '/fs/recents':
      return json({
        entries: [{ ...workspace.stat(DEMO_ROOT), name: 'garden', workspaceAddress: DEMO_ADDRESS }],
        path: DEMO_ROOT,
      })
    case '/fs/events':
      return eventStream(signal, (send) => {
        send('ready', { type: 'ready', root: DEMO_ROOT })
        const listener = (event: DemoChange) => send(event.type, event)
        workspace.listeners.add(listener)
        return () => workspace.listeners.delete(listener)
      })
    case '/fs/search/events':
      return finiteEvents(searchFiles(url, workspace.files))
    case '/fs/workspace-edit/recovery':
      return json({ operations: [], serverEpoch: 'garden-demo' })
    case '/orchestration/shell-snapshot':
      return json(orchestration.shell())
    case '/orchestration/session-detail':
      return json(orchestration.detail(url.searchParams.get('sessionId') ?? ''))
    case '/orchestration/session-import':
      return json([])
    case '/lsp/match':
      return json([])
    case '/lsp/semantic-tokens':
      return json(null)
  }
  if (url.pathname.startsWith('/fs/workspace-address/')) return json(DEMO_ADDRESS)
  // The one bundled Nerd Font carries the symbols every other code font borrows.
  if (url.pathname.startsWith('/fonts/nerd/')) return fetch(bypass(assets.font))
  if (/^\/providers\/[^/]+\/commands$/u.test(url.pathname))
    return json({
      providerInstanceId: url.pathname.split('/')[2],
      agents: [],
      commands: [],
      skills: [],
      supported: false,
    })
  if (/^\/providers\/[^/]+\/auth$/u.test(url.pathname))
    return json({
      providerInstanceId: url.pathname.split('/')[2],
      auth: { status: 'authenticated', type: 'demo' },
      checkedAt: new Date().toISOString(),
      supportsSignIn: false,
      signInMethods: [],
    })
  throw demoError(`Demo route not implemented: GET ${url.pathname}`, 'DEMO_ROUTE', 501)
}

async function post(
  url: URL,
  request: Request,
  workspace: DemoWorkspace,
  orchestration: DemoOrchestration,
): Promise<Response> {
  if (url.pathname === '/_log/ingest') return json({ ok: true })
  if (url.pathname === '/terminal/kill') return json({ killed: true })
  const body: unknown = await request.json()
  switch (url.pathname) {
    case '/fs/workspace-address':
      return json(DEMO_ADDRESS)
    case '/fs/workspace-root':
      return json({
        status: 'opened',
        entry: { ...workspace.stat(DEMO_ROOT), workspaceAddress: DEMO_ADDRESS },
        workspaceIndex: indexStatus(workspace),
      })
    case '/fs/recents':
      return json({ recorded: true })
    case '/fs/write': {
      const input = v.parse(writeBodySchema, body)
      return json(await workspace.writeFile(input.path, input.content, input))
    }
    case '/fs/create-file': {
      const input = v.parse(createFileBodySchema, body)
      return json(await workspace.writeFile(input.path, input.content ?? '', input))
    }
    case '/fs/create-folder':
      return json(workspace.createFolder(v.parse(createFolderBodySchema, body).path))
    case '/fs/rename': {
      const input = v.parse(renameBodySchema, body)
      return json(await workspace.movePath(input.from, input.to))
    }
    case '/fs/copy': {
      const input = v.parse(copyBodySchema, body)
      return json(await workspace.movePath(input.from, input.to, true))
    }
    case '/fs/delete':
      return json({ ...workspace.deletePath(v.parse(deleteBodySchema, body).path), deleted: true })
    case '/settings/write':
      return writeSettings(body, workspace)
    case '/orchestration/commands':
      return json(orchestration.dispatch(v.parse(clientOrchestrationCommandSchema, body)))
    case '/orchestration/session-search':
      return json({ matches: [] })
  }
  throw demoError(`Demo route not implemented: POST ${url.pathname}`, 'DEMO_ROUTE', 501)
}

function writeSettings(body: unknown, workspace: DemoWorkspace) {
  const input = v.parse(settingsMutationRequestSchema, body)
  const layer = workspace.settings.layers.find((candidate) => candidate.id === input.target)!
  const result = applySettingsOperations(layer.raw, input.operations)
  layer.raw = result.raw
  layer.file = {
    text: JSON.stringify(layer.raw, null, 2),
    revision: String(workspace.sequence + 1),
    parseErrors: [],
    keyRanges: {},
  }
  const resolved = resolveSettings(workspace.settings.layers)
  workspace.settings = v.parse(settingsSnapshotSchema, {
    ...workspace.settings,
    values: resolved.values,
    diagnostics: resolved.diagnostics,
    serverVersion: { epoch: 'garden-demo', sequence: workspace.sequence + 1 },
  })
  workspace.updated()
  return json({
    mutationId: input.mutationId,
    appliedVersion: workspace.settings.serverVersion,
    changedSettingIds: result.touchedSettingIds,
    duplicate: false,
    snapshot: workspace.settings,
  })
}

function indexStatus(workspace: DemoWorkspace) {
  return {
    entryCount: workspace.files.size + workspace.directories.size,
    fileCount: workspace.files.size,
    pendingCreatedPathCount: 0,
    readiness: 'ready',
    scanWarningCount: 0,
    scanRoot: DEMO_ROOT,
    skippedEntryCount: 0,
    staleEntryCount: 0,
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw demoError('File not found.', 'NOT_FOUND', 404)
  return value
}
function errorStatus(error: unknown) {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : 400
}
