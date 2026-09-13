import { spawn } from 'node:child_process'
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe } from 'vitest'
import { spawnTypeScript } from 'server/testing'
import { test as it, expect } from '../../../../test/fixtures'
import { createClientInvariantError } from '@/lib/structured-errors'
import { SEMANTIC_TOKEN_LEGENDS } from '../../../../test/factories/semantic-token-legends'

import { createSemanticTokenStyles } from '@singapor/core/syntax'
import { SEMANTIC_TOKEN_TYPES } from '@singapor/lsp'
import { decodeSemanticTokens } from '@singapor/lsp-plugin'

import { clientCapabilitiesForServer } from '@/features/editor/utils/client-capabilities'
import { semanticTokenProfileFor } from '@/features/editor/utils/semantic-token-servers'

// Probe installed optional servers and the application's bundled TypeScript runtime.
// Exact recorded legends make additions, removals, and reordered indices fail.
/** The twenty-three LSP defines. Every one already has a rule in the editor's theme. */
const STANDARD_TOKEN_TYPES = new Set(SEMANTIC_TOKEN_TYPES)

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

type ServerCase = {
  readonly serverId: string
  readonly resolve: () => typeof spawnTypeScript | null
  readonly files: Readonly<Record<string, string>>
  /** The row this test is pinning, from the per-server table's measurements. */
  readonly expected: { full: boolean; range: boolean; delta: boolean }
}

const CASES: readonly ServerCase[] = [
  {
    resolve: () => installedServer(rustAnalyzerBinary()),
    expected: { delta: true, full: true, range: true },
    files: {
      'Cargo.toml': '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub const MAX: usize = 10;\npub fn value() -> usize { MAX }\n',
    },
    serverId: 'rust',
  },
  {
    resolve: () => installedServer(onPath('gopls'), ['serve']),
    // `full: true` as a bare boolean, which is exactly why nothing reads a
    // `resultId` to decide delta: gopls returns one and refuses delta anyway.
    expected: { delta: false, full: true, range: true },
    files: {
      'go.mod': 'module probe\n\ngo 1.21\n',
      'main.go': 'package main\n\nfunc main() { println("x") }\n',
    },
    serverId: 'gopls',
  },
  {
    resolve: () => installedServer(onPath('clangd')),
    // `range: false`. The fact that makes request policy per server.
    expected: { delta: true, full: true, range: false },
    files: { 'main.c': '#include <stdio.h>\nint main(void){ printf("x"); return 0; }\n' },
    serverId: 'clangd',
  },
  {
    resolve: () => installedServer(onPath('zls')),
    // Measured on 0.16.0. `escapeSequence` sits at index 19, mid-legend.
    expected: { delta: false, full: true, range: true },
    files: { 'main.zig': 'pub fn main() void {}\n' },
    serverId: 'zls',
  },
  {
    resolve: () => installedServer(onPath('terraform-ls'), ['serve']),
    // 9, and only 9 because this server intersects its legend against the
    // `tokenTypes` we declare. Change that list and this number changes with it.
    expected: { delta: false, full: true, range: false },
    files: { 'main.tf': 'resource "null_resource" "probe" {}\n' },
    serverId: 'terraform',
  },
  {
    resolve: () => spawnTypeScript,
    expected: { delta: false, full: true, range: true },
    files: { 'a.ts': 'export const value = 1\n', 'package.json': '{"name":"probe"}\n' },
    serverId: 'typescript',
  },
]

describe('semantic token conformance', () => {
  for (const testCase of CASES) {
    it(`reproduces the recorded row for ${testCase.serverId}`, async ({ skip }) => {
      const launch = testCase.resolve()
      if (!launch) return skip(`${testCase.serverId} is not installed on this machine`)

      const provider = await negotiate(launch, testCase)
      expect(provider, `${testCase.serverId} advertised no semanticTokensProvider`).toBeTruthy()

      const full = (provider as { full?: unknown }).full
      expect({
        delta:
          typeof full === 'object' && full !== null && (full as { delta?: boolean }).delta === true,
        full: full === true || (typeof full === 'object' && full !== null),
        range: (provider as { range?: unknown }).range === true,
      }).toEqual({
        delta: testCase.expected.delta,
        full: testCase.expected.full,
        range: testCase.expected.range,
      })

      const legend = (provider as { legend?: { tokenTypes?: string[] } }).legend
      const tokenTypes = legend?.tokenTypes ?? []
      const recordedLegends = SEMANTIC_TOKEN_LEGENDS.filter(
        ({ serverId }) => serverId === testCase.serverId,
      ).map(({ tokenTypes }) => tokenTypes)
      expect(recordedLegends).toContainEqual(tokenTypes)

      // The assertion the alias table exists for, against a live legend rather
      // than a recorded one.
      const profile = semanticTokenProfileFor(testCase.serverId)
      // A name the table has never heard of: not aliased, and not on the list of
      // names this app declines on purpose. Either the server grew one or the
      // row was written from a legend it no longer has.
      const unknownNames = [...new Set(tokenTypes)].filter(
        (name) =>
          !(name in profile.scopeAliases) &&
          !(name in profile.uncovered) &&
          !STANDARD_TOKEN_TYPES.has(name),
      )
      expect(unknownNames).toEqual([])
    }, 90_000)
  }
})

/**
 * The end-to-end assertion: real server bytes, the editor's real decoder, this
 * repo's real alias table.
 *
 * Everything else here checks one hop. This one runs the whole contract — ask a
 * live rust-analyzer for a whole file, decode the 5-tuples through the export the
 * editor ships for exactly this, and resolve every name through the table — and
 * it is the only test that would notice if the three agreed with each other while
 * all being wrong.
 */
describe('semantic tokens end to end', () => {
  it('decodes a live rust-analyzer answer into spans this theme can paint', async ({ skip }) => {
    const binary = rustAnalyzerBinary()
    if (!binary) return skip('no rust-analyzer on this machine')

    const source = 'pub const MAX: usize = 10;\npub fn value(n: usize) -> usize { n + MAX }\n'
    const session = await tokenSession(binary, source)
    if (!session) return skip('rust-analyzer did not answer a token request in time')

    const { data, legend } = session
    const lineStarts = [0]
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === '\n') lineStarts.push(index + 1)
    }

    const decoded = decodeSemanticTokens(data, legend, { lineStarts, textLength: source.length })

    expect(decoded.spans.length).toBeGreaterThan(0)
    // Every rejection rule is a fact about the server, and a healthy answer trips
    // none of them.
    expect(decoded.drops).toMatchObject({
      malformedTuple: 0,
      outOfLegendType: 0,
      pastEndOfDocument: 0,
      zeroLength: 0,
    })

    const profile = semanticTokenProfileFor('rust')
    const styles = createSemanticTokenStyles({ scopeAliases: profile.scopeAliases })
    const unresolved = [
      ...new Set(
        decoded.spans
          .filter((span) => styles.resolve(span.tokenType, span.tokenModifiers) === null)
          .map((span) => span.tokenType),
      ),
    ].filter((name) => !(name in profile.uncovered))

    // The assertion that would have caught 38 of 57 types dropping silently.
    expect(unresolved).toEqual([])

    // And the spans really do land on the text they name.
    const constant = decoded.spans.find((span) => source.slice(span.start, span.end) === 'MAX')
    expect(constant).toBeDefined()
    expect(styles.scopeFor(constant!.tokenType, constant!.tokenModifiers)).toContain('variable')
  }, 120_000)
})

function installedServer(
  binary: string | null,
  args: readonly string[] = [],
): typeof spawnTypeScript | null {
  if (!binary) return null
  return async (root) => ({ process: spawn(binary, args, { cwd: root, stdio: 'pipe' }) })
}

async function negotiate(launch: typeof spawnTypeScript, testCase: ServerCase): Promise<unknown> {
  const root = mkdtempSync(path.join(tmpdir(), `platform-lsp-conformance-${testCase.serverId}-`))
  roots.push(root)
  for (const [name, content] of Object.entries(testCase.files)) {
    const target = path.join(root, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  const handle = await launch(root)
  if (!handle) throw createClientInvariantError(`${testCase.serverId} did not start`)
  const child = handle.process
  const messages: Record<string, unknown>[] = []
  readLspMessages(child.stdout, (message) => messages.push(message))
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  const params = {
    capabilities: clientCapabilitiesForServer(testCase.serverId),
    clientInfo: { name: '@singapor/lsp' },
    processId: process.pid,
    initializationOptions: handle.initializationOptions,
    rootUri: `file://${root}`,
    workspaceFolders: [{ name: 'probe', uri: `file://${root}` }],
  }
  writeLspMessage(child.stdin, { id: 1, jsonrpc: '2.0', method: 'initialize', params })

  try {
    const response = await waitFor(() => messages.find((message) => message.id === 1), 60_000)
    expect(response, `${testCase.serverId} initialize timed out: ${stderr}`).toBeDefined()
    expect(response?.error, `${testCase.serverId} initialize failed: ${stderr}`).toBeUndefined()
    const result = response?.result as { capabilities?: Record<string, unknown> } | undefined
    return result?.capabilities?.semanticTokensProvider ?? null
  } finally {
    child.kill()
  }
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return undefined
}

function writeLspMessage(stdin: NodeJS.WritableStream, message: unknown): void {
  const body = JSON.stringify(message)
  stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
}

function readLspMessages(
  stdout: NodeJS.ReadableStream,
  onMessage: (message: Record<string, unknown>) => void,
): void {
  let buffer = Buffer.alloc(0)
  stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      const header = buffer.subarray(0, headerEnd).toString('ascii')
      const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1] ?? 0)
      if (buffer.length < headerEnd + 4 + length) return

      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
      buffer = buffer.subarray(headerEnd + 4 + length)
      onMessage(JSON.parse(body) as Record<string, unknown>)
    }
  })
}

/**
 * Where the app itself would find this server: its own install directories
 * first, then `PATH`.
 *
 * The two extra directories mirror `which(command, [toolRoot, nodePackageBin])`
 * in `apps/server/src/lsp/installers.ts`. Without them this test would skip on
 * exactly the machines where the app *has* downloaded a server — which is every
 * machine that has actually used the feature.
 */
function onPath(command: string): string | null {
  const lspRoot = path.join(homedir(), '.platform', 'lsp')
  const directories = [
    path.join(lspRoot, 'bin'),
    path.join(lspRoot, 'node', 'node_modules', '.bin'),
    ...(process.env.PATH?.split(path.delimiter) ?? []),
  ]
  for (const directory of directories) {
    const candidate = path.join(directory, command)
    if (isExecutable(candidate)) return candidate
  }

  return null
}

/**
 * The real server inside the toolchain, never `~/.cargo/bin/rust-analyzer`.
 *
 * That one is a rustup proxy which exits with `'rust-analyzer' is not installed
 * for the toolchain` unless the component happens to be installed for the active
 * toolchain — so a PATH lookup alone would make this test skip on a machine that
 * has rust-analyzer, or hang on one that does not.
 */
function rustAnalyzerBinary(): string | null {
  const toolchains = path.join(homedir(), '.rustup', 'toolchains')
  const entries = safeReaddir(toolchains)
  for (const entry of entries.toSorted()) {
    const candidate = path.join(toolchains, entry, 'bin', 'rust-analyzer')
    if (isExecutable(candidate)) return candidate
  }

  const onPathBinary = onPath('rust-analyzer')
  if (onPathBinary && path.dirname(onPathBinary) === path.join(homedir(), '.cargo', 'bin')) {
    return null
  }

  return onPathBinary
}

function safeReaddir(directory: string): string[] {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Drives one real server all the way to a token payload: initialize, initialized,
 * didOpen, then `semanticTokens/full`.
 */
async function tokenSession(
  binary: string,
  source: string,
): Promise<{ data: number[]; legend: { tokenTypes: string[]; tokenModifiers: string[] } } | null> {
  const root = mkdtempSync(path.join(tmpdir(), 'platform-lsp-tokens-'))
  roots.push(root)
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(
    path.join(root, 'Cargo.toml'),
    '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n',
  )
  const file = path.join(root, 'src', 'lib.rs')
  writeFileSync(file, source)

  const child = spawn(binary, [], { cwd: root, stdio: 'pipe' })
  const messages: Record<string, unknown>[] = []
  readLspMessages(child.stdout, (message) => messages.push(message))
  child.stderr.resume()

  try {
    writeLspMessage(child.stdin, {
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: clientCapabilitiesForServer('rust'),
        clientInfo: { name: '@singapor/lsp' },
        processId: process.pid,
        rootUri: `file://${root}`,
        workspaceFolders: [{ name: 'probe', uri: `file://${root}` }],
      },
    })
    const initialized = await waitFor(() => messages.find((message) => message.id === 1), 60_000)
    const capabilities = (initialized?.result as { capabilities?: Record<string, unknown> })
      ?.capabilities
    const provider = capabilities?.semanticTokensProvider as
      | { legend?: { tokenTypes?: string[]; tokenModifiers?: string[] } }
      | undefined
    const legend = provider?.legend
    if (!legend?.tokenTypes) return null

    writeLspMessage(child.stdin, { jsonrpc: '2.0', method: 'initialized', params: {} })
    writeLspMessage(child.stdin, {
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: { languageId: 'rust', text: source, uri: `file://${file}`, version: 1 },
      },
    })

    // rust-analyzer answers an empty payload until the crate graph is built, so
    // ask until it has something rather than pinning a sleep.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const id = 100 + attempt
      writeLspMessage(child.stdin, {
        id,
        jsonrpc: '2.0',
        method: 'textDocument/semanticTokens/full',
        params: { textDocument: { uri: `file://${file}` } },
      })
      const response = await waitFor(() => messages.find((message) => message.id === id), 10_000)
      const data = (response?.result as { data?: number[] } | null)?.data
      if (data && data.length > 0) {
        return {
          data,
          legend: {
            tokenModifiers: legend.tokenModifiers ?? [],
            tokenTypes: legend.tokenTypes,
          },
        }
      }
    }

    return null
  } finally {
    child.kill()
  }
}
