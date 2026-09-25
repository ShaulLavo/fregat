import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import {
  defaultClientCapabilities,
  mergeClientCapabilities,
  semanticTokensClientCapability,
} from '@singapore-editor/lsp'
import { isRecord } from '@workspace/utils/objects'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  installedTypeScriptRuntimeFixture,
  watchableTempDirectory,
} from '../../../test/factories/typescript-runtime'
import { createWorkspacePaths, isOutsideRoot } from '../../fs/path'
import { treeWatchSource } from '../../fs/tree-watch'
import { FileChangeHub } from '../../fs/watch'
import { createInternalError } from '../../observability/structured-errors'
import { fileUriForPath } from '@workspace/contracts'
import { LspSessionPool, type LspProxyClientSession, type LspProxySocket } from '../proxy-session'
import { resolveLspServer } from '../registry'
import { LspWatchedFiles } from '../watched-files'

const IMPORT = 'import { helper } from "./nested/my-helper";'
const SOURCE = `const count: number = "wrong";\ncount.toFixed();\n${IMPORT}\n`
const SETTINGS = { servers: {}, languageServers: {}, tyForPython: false } as const
const RUNTIMES = [
  { packageName: 'typescript', native: true },
  { packageName: 'typescript-language-service', native: false },
] as const
const fixtures: Awaited<ReturnType<typeof installedTypeScriptRuntimeFixture>>[] = []
const pools: LspSessionPool[] = []
const hubs: FileChangeHub[] = []
const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const pool of pools.splice(0)) pool.disposeAll()
  await Promise.all(hubs.splice(0).map((hub) => hub.close()))
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function watchedPool() {
  const paths = createWorkspacePaths('/')
  const hub = new FileChangeHub(paths, { enabled: true })
  hubs.push(hub)
  const pool = new LspSessionPool(() => 120_000, undefined, treeWatchSource(hub, paths))
  pools.push(pool)
  const registrations = vi.spyOn(LspWatchedFiles.prototype, 'register')
  cleanups.push(async () => registrations.mockRestore())
  return { pool, registrations: registrations.mock }
}

class RecordingSocket implements LspProxySocket {
  readonly sent: Record<string, unknown>[] = []

  close(): void {}

  send(message: string): void {
    const parsed: unknown = JSON.parse(message)
    if (!isRecord(parsed)) throw createInternalError('LSP test received a non-object message')
    this.sent.push(parsed)
  }

  answer(id: number) {
    return this.sent.find((message) => message.id === id)
  }

  notification(method: string) {
    return this.sent.findLast((message) => message.method === method)?.params
  }
}

describe('workspace TypeScript against real language servers', () => {
  it.each(RUNTIMES)(
    'refreshes diagnostics after external dependency edits with $packageName',
    async ({ packageName, native }) => {
      const source = 'import { value } from "./dependency";\nexport const count: number = value;\n'
      const fixture = await installedTypeScriptRuntimeFixture(packageName, {
        'package.json': '{"private":true,"type":"module"}\n',
        'tsconfig.json': '{"compilerOptions":{"strict":true},"files":["probe.ts"]}\n',
        'probe.ts': source,
        'dependency.ts': 'export const value = "wrong";\n',
      })
      fixtures.push(fixture)
      const { root } = fixture
      const filePath = path.join(root, 'probe.ts')
      const uri = fileUriForPath(filePath)
      const match = await resolveLspServer({
        filePath,
        serverId: 'typescript',
        settings: SETTINGS,
        workspaceRoot: root,
      })
      if (!match) throw createInternalError('TypeScript fixture did not match its language server')
      const { pool, registrations } = watchedPool()
      const socket = new RecordingSocket()
      const session = await pool.acquire(socket, match, root)
      if (!session)
        throw createInternalError('TypeScript fixture did not start its language server')
      await request(session, socket, 1, 'initialize', initializeParams(root))
      await notify(session, 'initialized', {})
      await notify(session, 'textDocument/didOpen', {
        textDocument: { languageId: 'typescript', text: source, uri, version: 1 },
      })
      await assertDiagnostics(session, socket, native, uri)
      if (native) await expect.poll(() => registeredWatch(registrations, root)).toBe(true)

      const dependency = path.join(root, 'dependency.ts')
      const changes = [
        { apply: () => writeFile(dependency, 'export const value = 1;\n'), codes: [] },
        {
          apply: async () => {
            await writeFile(`${dependency}.tmp`, 'export const value = "wrong";\n')
            await rename(`${dependency}.tmp`, dependency)
          },
          codes: [2322],
        },
        { apply: () => rm(dependency), codes: [2307] },
        { apply: () => writeFile(dependency, 'export const value = 1;\n'), codes: [] },
      ]
      let id = 10
      for (const change of changes) {
        socket.sent.length = 0
        await change.apply()
        await assertExternalDiagnostics(session, socket, native, uri, id++, change.codes)
      }
    },
  )

  it.each(RUNTIMES)(
    'refreshes diagnostics when linked packages outside the project change with $packageName',
    async ({ packageName, native }) => {
      // Two packages in different directories: the server asks to watch their common ancestor.
      const first = await linkedPackage('first', 'string')
      const second = await linkedPackage('second', 'string')
      const source =
        'import { first } from "first";\nimport { second } from "second";\n' +
        'export const a: number = first;\nexport const b: number = second;\n'
      const fixture = await installedTypeScriptRuntimeFixture(packageName, {
        'package.json': '{"private":true,"type":"module"}\n',
        'tsconfig.json':
          '{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler"},"files":["probe.ts"]}\n',
        'probe.ts': source,
      })
      fixtures.push(fixture)
      const { root } = fixture
      await symlink(first, path.join(root, 'node_modules/first'), 'dir')
      await symlink(second, path.join(root, 'node_modules/second'), 'dir')
      const filePath = path.join(root, 'probe.ts')
      const uri = fileUriForPath(filePath)
      const match = await resolveLspServer({
        filePath,
        serverId: 'typescript',
        settings: SETTINGS,
        workspaceRoot: root,
      })
      if (!match) throw createInternalError('TypeScript fixture did not match its language server')
      const { pool, registrations } = watchedPool()
      const socket = new RecordingSocket()
      const session = await pool.acquire(socket, match, root)
      if (!session)
        throw createInternalError('TypeScript fixture did not start its language server')
      await request(session, socket, 1, 'initialize', initializeParams(root))
      await notify(session, 'initialized', {})
      await notify(session, 'textDocument/didOpen', {
        textDocument: { languageId: 'typescript', text: source, uri, version: 1 },
      })
      await assertDiagnostics(session, socket, native, uri)
      // tsgo registers the packages' watch after its first answer (tsserver watches on its own).
      // A write before that is lost, and a refresh for the `node_modules` alias pulls stale types.
      const watched = () => [first, second].every((dir) => registeredWatch(registrations, dir))
      if (native) await expect.poll(watched, { timeout: 20_000 }).toBe(true)

      const declarations = (target: string) => path.join(target, 'dist/index.d.ts')
      const changes = [
        {
          apply: () => writeFile(declarations(first), 'export declare const first: number\n'),
          codes: [2322],
        },
        {
          apply: () => writeFile(declarations(second), 'export declare const second: number\n'),
          codes: [],
        },
        // A rebuild: the declarations go away, then come back.
        { apply: () => rm(path.join(first, 'dist'), { recursive: true }), codes: [2307] },
        {
          apply: async () => {
            await mkdir(path.join(first, 'dist'))
            await writeFile(declarations(first), 'export declare const first: number\n')
          },
          codes: [],
        },
      ]
      let id = 10
      for (const change of changes) {
        socket.sent.length = 0
        await change.apply()
        await assertExternalDiagnostics(session, socket, native, uri, id++, change.codes)
      }
    },
  )

  it.each(RUNTIMES)(
    'rechecks the project when its configuration changes with $packageName',
    async ({ packageName, native }) => {
      // An implicit any is an error only under `noImplicitAny`; unused locals stay suggestions.
      const config = (noImplicitAny: boolean) =>
        `{"compilerOptions":{"noImplicitAny":${noImplicitAny}},"files":["probe.ts"]}\n`
      const probe = await openProbe(
        packageName,
        { 'tsconfig.json': config(false) },
        'export function f(x) {\n  return x\n}\n',
      )
      await expectCodes(probe, native, [])

      await writeFile(path.join(probe.root, 'tsconfig.json'), config(true))
      await assertExternalDiagnostics(probe.session, probe.socket, native, probe.uri, 20, [7006])
    },
  )

  it.each(RUNTIMES)(
    'resolves a package once it is installed with $packageName',
    async ({ packageName, native }) => {
      const probe = await openProbe(
        packageName,
        {},
        'import { fresh } from "fresh";\nexport const n: number = fresh;\n',
      )
      await expectCodes(probe, native, [2307])

      // Bun's layout: the package lands in its store, then a link appears at the top level.
      const store = path.join(probe.root, 'node_modules/.bun/fresh@1.0.0/node_modules/fresh')
      await mkdir(store, { recursive: true })
      await writeFile(
        path.join(store, 'package.json'),
        '{"name":"fresh","version":"1.0.0","types":"index.d.ts"}',
      )
      await writeFile(path.join(store, 'index.d.ts'), 'export declare const fresh: number\n')
      await symlink(
        '.bun/fresh@1.0.0/node_modules/fresh',
        path.join(probe.root, 'node_modules/fresh'),
      )
      await assertExternalDiagnostics(probe.session, probe.socket, native, probe.uri, 20, [])
    },
  )

  it.each(RUNTIMES)(
    'follows a branch switch that rewrites a dependency with $packageName',
    async ({ packageName, native }) => {
      const probe = await openProbe(
        packageName,
        { 'dependency.ts': 'export const value = 1;\n' },
        'import { value } from "./dependency";\nexport const count: number = value;\n',
      )
      await expectCodes(probe, native, [])
      const git = (...args: string[]) => {
        const result = Bun.spawnSync(['git', '-C', probe.root, ...args], { stderr: 'pipe' })
        if (result.exitCode !== 0) throw createInternalError(result.stderr.toString())
      }
      git('init', '--quiet', '--initial-branch=main')
      git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', 'dependency.ts')
      git(
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'main',
      )
      git('checkout', '--quiet', '-b', 'other')
      await writeFile(path.join(probe.root, 'dependency.ts'), 'export const value = "wrong";\n')
      git(
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        'commit',
        '--quiet',
        '-am',
        'other',
      )
      await assertExternalDiagnostics(probe.session, probe.socket, native, probe.uri, 20, [2322])

      probe.socket.sent.length = 0
      git('checkout', '--quiet', 'main')
      await assertExternalDiagnostics(probe.session, probe.socket, native, probe.uri, 21, [])
    },
  )

  it.each(RUNTIMES)('serves editor features with $packageName', async ({ packageName, native }) => {
    const fixture = await installedTypeScriptRuntimeFixture(packageName, {
      'package.json': '{"private":true,"type":"module"}\n',
      'tsconfig.json': '{"compilerOptions":{"strict":true},"files":["probe.ts"]}\n',
      'probe.ts': SOURCE,
      'nested/my-helper.ts': 'export function helper() { return 1 }\n',
    })
    fixtures.push(fixture)
    const { root, version } = fixture
    const filePath = path.join(root, 'probe.ts')
    const uri = fileUriForPath(filePath)
    const match = await resolveLspServer({
      filePath,
      serverId: 'typescript',
      settings: SETTINGS,
      workspaceRoot: root,
    })
    if (!match) throw createInternalError('TypeScript fixture did not match its language server')

    const { pool } = watchedPool()
    const socket = new RecordingSocket()
    const session = await pool.acquire(socket, match, root)
    if (!session) throw createInternalError('TypeScript fixture did not start its language server')

    const initialized = await request(session, socket, 1, 'initialize', initializeParams(root))
    expect(initialized).toMatchObject({
      capabilities: {
        completionProvider: { resolveProvider: true },
        hoverProvider: true,
        definitionProvider: true,
        semanticTokensProvider: { full: true },
      },
    })
    await notify(session, 'initialized', {})
    await assertRuntime(initialized, socket, native, version)
    await notify(session, 'textDocument/didOpen', {
      textDocument: { languageId: 'typescript', text: SOURCE, uri, version: 1 },
    })
    await assertDiagnostics(session, socket, native, uri)

    const textDocument = { uri }
    const position = { line: 1, character: 2 }
    const hover = await request(session, socket, 3, 'textDocument/hover', {
      textDocument,
      position,
    })
    expect(hover).toMatchObject({
      contents: {
        kind: 'markdown',
        value: expect.stringContaining('```typescript\nconst count: number\n```'),
      },
    })
    const definition = await request(session, socket, 4, 'textDocument/definition', {
      textDocument,
      position,
    })
    expect(definition).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUri: uri,
          targetSelectionRange: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 11 },
          },
        }),
      ]),
    )
    const completion = await request(session, socket, 5, 'textDocument/completion', {
      textDocument,
      position: { line: 1, character: 6 },
      context: { triggerKind: 1 },
    })
    expect(completion).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ label: 'toFixed' })]),
    })
    const tokens = await request(session, socket, 6, 'textDocument/semanticTokens/full', {
      textDocument,
    })
    expect(tokens).toMatchObject({ data: expect.arrayContaining([expect.any(Number)]) })

    for (const character of ['/', '-']) {
      const imported = await request(
        session,
        socket,
        7 + IMPORT.indexOf(character),
        'textDocument/definition',
        {
          textDocument,
          position: { line: 2, character: IMPORT.indexOf(character) },
        },
      )
      expect(imported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetUri: fileUriForPath(path.join(root, 'nested/my-helper.ts')),
            originSelectionRange: {
              start: { line: 2, character: IMPORT.indexOf('"') },
              end: { line: 2, character: IMPORT.lastIndexOf('"') + 1 },
            },
          }),
        ]),
      )
    }
  })
})

async function assertExternalDiagnostics(
  session: LspProxyClientSession,
  socket: RecordingSocket,
  native: boolean,
  uri: string,
  id: number,
  codes: readonly number[],
) {
  if (!native) {
    await expect.poll(() => publishedErrors(socket, uri), { timeout: 20_000 }).toEqual(codes)
    return
  }
  await expect
    .poll(() => socket.sent.some((message) => message.method === 'workspace/diagnostic/refresh'), {
      timeout: 20_000,
    })
    .toBe(true)
  const result = await request(session, socket, id, 'textDocument/diagnostic', {
    identifier: 'typescript',
    textDocument: { uri },
  })
  expect(errorCodes(result, 'items')).toEqual(codes)
}

/** Whether a watch registration that covers `target` has been attached. */
function registeredWatch(mock: MockInstance<LspWatchedFiles['register']>['mock'], target: string) {
  return mock.calls.some(
    ([, options], index) =>
      mock.settledResults[index]?.type === 'fulfilled' &&
      watchBases(options).some((base) => !isOutsideRoot(path.relative(base, target))),
  )
}

function watchBases(options: unknown): string[] {
  const watchers = isRecord(options) && Array.isArray(options.watchers) ? options.watchers : []
  return watchers.flatMap((watcher: unknown) => {
    const glob = isRecord(watcher) ? watcher.globPattern : undefined
    if (typeof glob === 'string') return [glob.split('*')[0] ?? glob]
    if (isRecord(glob) && typeof glob.baseUri === 'string') return [fileURLToPath(glob.baseUri)]
    return []
  })
}

/** Error codes only: TypeScript also reports suggestions, such as an unused local, as hints. */
function errorCodes(container: unknown, field: 'items' | 'diagnostics') {
  const list = isRecord(container) && Array.isArray(container[field]) ? container[field] : []
  return list.flatMap((item: unknown) => (isRecord(item) && item.severity === 1 ? [item.code] : []))
}

function publishedErrors(socket: RecordingSocket, uri: string) {
  const params = socket.sent.findLast(
    (message) =>
      message.method === 'textDocument/publishDiagnostics' &&
      isRecord(message.params) &&
      message.params.uri === uri,
  )?.params
  return params === undefined ? null : errorCodes(params, 'diagnostics')
}

type Probe = {
  readonly root: string
  readonly registrations: MockInstance<LspWatchedFiles['register']>['mock']
  readonly session: LspProxyClientSession
  readonly socket: RecordingSocket
  readonly uri: string
}

async function openProbe(
  packageName: string,
  files: Readonly<Record<string, string>>,
  source: string,
): Promise<Probe> {
  const fixture = await installedTypeScriptRuntimeFixture(packageName, {
    'package.json': '{"private":true,"type":"module"}\n',
    'tsconfig.json': '{"compilerOptions":{"strict":true},"files":["probe.ts"]}\n',
    ...files,
    'probe.ts': source,
  })
  fixtures.push(fixture)
  const { root } = fixture
  const filePath = path.join(root, 'probe.ts')
  const uri = fileUriForPath(filePath)
  const match = await resolveLspServer({
    filePath,
    serverId: 'typescript',
    settings: SETTINGS,
    workspaceRoot: root,
  })
  if (!match) throw createInternalError('TypeScript fixture did not match its language server')
  const socket = new RecordingSocket()
  const { pool, registrations } = watchedPool()
  const session = await pool.acquire(socket, match, root)
  if (!session) throw createInternalError('TypeScript fixture did not start its language server')
  await request(session, socket, 1, 'initialize', initializeParams(root))
  await notify(session, 'initialized', {})
  await notify(session, 'textDocument/didOpen', {
    textDocument: { languageId: 'typescript', text: source, uri, version: 1 },
  })
  return { root, registrations, session, socket, uri }
}

/** The state the server settles on first; there is no refresh to wait for yet. */
async function expectCodes(probe: Probe, native: boolean, codes: readonly number[]) {
  if (!native) {
    await expect
      .poll(() => publishedErrors(probe.socket, probe.uri), { timeout: 20_000 })
      .toEqual(codes)
    probe.socket.sent.length = 0
    return
  }
  const result = await request(probe.session, probe.socket, 2, 'textDocument/diagnostic', {
    identifier: 'typescript',
    textDocument: { uri: probe.uri },
  })
  expect(errorCodes(result, 'items')).toEqual(codes)
  // tsgo can answer diagnostics before its dynamic watches have attached.
  await expect.poll(() => registeredWatch(probe.registrations, probe.root)).toBe(true)
  probe.socket.sent.length = 0
}

async function linkedPackage(name: string, type: string) {
  const target = await watchableTempDirectory(`platform-linked-${name}-`)
  cleanups.push(() => rm(path.dirname(target), { recursive: true, force: true }))
  await mkdir(path.join(target, 'dist'))
  await writeFile(
    path.join(target, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', types: 'dist/index.d.ts' }),
  )
  await writeFile(path.join(target, 'dist/index.d.ts'), `export declare const ${name}: ${type}\n`)
  return target
}

function initializeParams(root: string) {
  const capabilities = mergeClientCapabilities(
    defaultClientCapabilities(),
    semanticTokensClientCapability({
      augmentsSyntaxTokens: true,
      formats: ['relative'],
      requests: { full: { delta: false }, range: true },
    }),
  )
  return {
    capabilities,
    clientInfo: { name: '@singapore-editor/lsp' },
    processId: process.pid,
    rootUri: fileUriForPath(root),
    workspaceFolders: [{ name: path.basename(root), uri: fileUriForPath(root) }],
  }
}

async function assertRuntime(
  initialized: unknown,
  socket: RecordingSocket,
  native: boolean,
  version: string,
) {
  if (native) {
    expect(initialized).toMatchObject({ serverInfo: { name: 'typescript-go', version } })
    return
  }

  await expect.poll(() => socket.notification('$/typescriptVersion')).toMatchObject({ version })
}

async function assertDiagnostics(
  session: LspProxyClientSession,
  socket: RecordingSocket,
  native: boolean,
  uri: string,
) {
  const expected = expect.arrayContaining([
    expect.objectContaining({
      code: 2322,
      message: "Type 'string' is not assignable to type 'number'.",
    }),
  ])
  if (native) {
    const result = await request(session, socket, 2, 'textDocument/diagnostic', {
      identifier: 'typescript',
      textDocument: { uri },
    })
    expect(result).toMatchObject({ kind: 'full', items: expected })
    return
  }

  await expect
    .poll(() => socket.notification('textDocument/publishDiagnostics'), { timeout: 20_000 })
    .toMatchObject({ uri, diagnostics: expected })
}

async function request(
  session: LspProxyClientSession,
  socket: RecordingSocket,
  id: number,
  method: string,
  params: unknown,
) {
  await session.handleClientMessage(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  await expect.poll(() => socket.answer(id), { timeout: 20_000 }).toBeDefined()
  const answer = socket.answer(id)
  expect(answer).not.toHaveProperty('error')
  return answer?.result
}

function notify(session: LspProxyClientSession, method: string, params: unknown) {
  return session.handleClientMessage(JSON.stringify({ jsonrpc: '2.0', method, params }))
}
