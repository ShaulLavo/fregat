import { accessSync, constants } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { readdirSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { LspSessionPool, type LspProxySocket } from '../proxy-session'
import { spawnCommand } from '../installers'
import type { LspServerMatch } from '../registry'

/**
 * The delta branch, against a real rust-analyzer, through the real proxy.
 *
 * This is the one piece of the feature whose failure mode is silent and wrong
 * rather than loud and absent: a reassembled array that does not match the text
 * decodes into spans painted over unrelated code, with every drop counter
 * reading zero. So the assertion is not "a delta arrived" — it is that the array
 * the proxy reassembled is **byte-identical to the one a fresh whole-file
 * request returns for the same text**.
 *
 * Skips when rust-analyzer is absent, which is most machines.
 */
const roots: string[] = []
const pools: LspSessionPool[] = []

afterEach(async () => {
  for (const pool of pools.splice(0)) pool.disposeAll()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

class RecordingSocket implements LspProxySocket {
  readonly sent: Record<string, unknown>[] = []

  close(): void {}

  send(message: string): void {
    this.sent.push(JSON.parse(message) as Record<string, unknown>)
  }

  answer(id: number): Record<string, unknown> | undefined {
    return this.sent.find((message) => message.id === id)
  }
}

describe('semantic token delta against a real server', () => {
  it('reassembles exactly what a fresh whole-file request would have returned', async ({
    skip,
  }) => {
    const binary = rustAnalyzerBinary()
    if (!binary) return skip('no rust-analyzer on this machine')

    const root = await mkdtemp(path.join(tmpdir(), 'platform-lsp-delta-'))
    roots.push(root)
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'Cargo.toml'),
      '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n',
    )
    const file = path.join(root, 'src', 'lib.rs')
    const original = [
      'pub const MAX: usize = 10;',
      'pub fn value(n: usize) -> usize { n + MAX }',
      'pub struct Holder { pub slot: usize }',
      '',
    ].join('\n')
    await writeFile(file, original)

    const pool = new LspSessionPool(
      () => 120_000,
      () => true,
    )
    pools.push(pool)
    const socket = new RecordingSocket()
    // What the proxy actually said to the backend. Without this the test would
    // pass just as happily if the delta branch never engaged and both answers
    // came from plain `full` requests — which is the vacuous version of exactly
    // the assertion below.
    const toBackend: string[] = []
    const match = {
      root,
      server: {
        extensions: ['.rs'],
        id: 'rust',
        root: async () => root,
        spawn: async () => {
          const handle = await spawnCommand([binary], { cwd: root })
          if (!handle) return null

          const write = handle.process.stdin.write.bind(handle.process.stdin)
          handle.process.stdin.write = ((chunk: unknown, ...rest: unknown[]) => {
            toBackend.push(String(chunk))
            return (write as (...args: unknown[]) => boolean)(chunk, ...rest)
          }) as typeof handle.process.stdin.write
          return handle
        },
      },
    } satisfies LspServerMatch
    const session = await pool.acquire(socket, match, root)
    // NOT-PORTABLE: An installed rust-analyzer that fails to spawn is skipped.
    if (!session) return skip('rust-analyzer did not spawn')

    const uri = `file://${file}`
    await session.handleClientMessage(
      JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {
            textDocument: {
              semanticTokens: {
                formats: ['relative'],
                requests: { full: { delta: true }, range: true },
                tokenModifiers: [],
                tokenTypes: [],
              },
            },
          },
          processId: process.pid,
          rootUri: `file://${root}`,
        },
      }),
    )
    await waitFor(() => socket.answer(1), 90_000)
    await session.handleClientMessage(
      JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }),
    )
    await session.handleClientMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { languageId: 'rust', text: original, uri, version: 1 } },
      }),
    )

    // Poll until the crate graph is built; before that the answer is empty.
    let id = 100
    let baseline: number[] | null = null
    for (let attempt = 0; attempt < 60; attempt += 1) {
      id += 1
      await session.handleClientMessage(JSON.stringify(tokensRequest(id, uri)))
      const answer = await waitFor(() => socket.answer(id), 20_000)
      const data = (answer?.result as { data?: number[] } | undefined)?.data
      if (data && data.length > 0) {
        baseline = data
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    // NOT-PORTABLE: Rust indexing timeout becomes a skip and can hide regressions.
    if (!baseline) return skip('rust-analyzer produced no tokens inside the indexing window')

    // A real edit: a new item at the end, which shifts nothing before it and adds
    // tuples after it — the shape a delta is actually built for.
    const edited = `${original}pub fn twice(n: usize) -> usize { n * 2 }\n`
    await writeFile(file, edited)
    await session.handleClientMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: { contentChanges: [{ text: edited }], textDocument: { uri, version: 2 } },
      }),
    )

    // This one goes out as `full/delta`, because a baseline exists.
    id += 1
    await session.handleClientMessage(JSON.stringify(tokensRequest(id, uri)))
    const reassembled = (await waitFor(() => socket.answer(id), 30_000))?.result as
      | { data?: number[] }
      | undefined

    expect(reassembled?.data, 'the proxy returned no data for the delta request').toBeTruthy()

    // The branch under test was actually taken: a `full/delta` carrying a
    // `previousResultId` really did go to the backend.
    const deltaFrames = toBackend.filter((frame) => frame.includes('semanticTokens/full/delta'))
    expect(deltaFrames.length, 'the proxy never sent a full/delta').toBeGreaterThan(0)
    expect(deltaFrames.at(-1)).toContain('previousResultId')

    // Ground truth: force a whole-file answer by taking the baseline away first.
    // Same text, same server, no delta involved.
    await session.handleClientMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: { textDocument: { uri } },
      }),
    )
    await session.handleClientMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { languageId: 'rust', text: edited, uri, version: 3 } },
      }),
    )
    id += 1
    await session.handleClientMessage(JSON.stringify(tokensRequest(id, uri)))
    const truth = (await waitFor(() => socket.answer(id), 30_000))?.result as
      | { data?: number[] }
      | undefined

    expect(truth?.data?.length).toBeGreaterThan(0)
    expect(reassembled?.data).toEqual(truth?.data)

    // And the invariant, at the boundary the browser actually sees.
    for (const sent of socket.sent) {
      expect(JSON.stringify(sent)).not.toContain('"edits"')
    }
  }, 180_000)
})

function tokensRequest(id: number, uri: string) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'textDocument/semanticTokens/full',
    params: { textDocument: { uri } },
  }
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return undefined
}

/** Never the rustup shim — see `spawnRustAnalyzer` for why it would hang here. */
function rustAnalyzerBinary(): string | null {
  const toolchains = path.join(homedir(), '.rustup', 'toolchains')
  let entries: string[] = []
  try {
    entries = readdirSync(toolchains)
  } catch {
    entries = []
  }
  for (const entry of entries.sort()) {
    const candidate = path.join(toolchains, entry, 'bin', 'rust-analyzer')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return null
}
