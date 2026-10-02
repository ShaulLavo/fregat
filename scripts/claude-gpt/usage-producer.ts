import { defineErrorCatalog } from 'evlog'
import * as v from 'valibot'
import { lstat, mkdir, open, readdir, readlink, realpath, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  configuredAccounts,
  createUsageSnapshot,
  maxFeedBytes,
  normalizeProxySnapshot,
  observeClaudeHeaders,
  restoreUsageSnapshot,
  usageAccountsSchema,
  type UsageAccountConfig,
  type UsageSnapshot,
} from './usage-feed'

export type UsageProducerOptions = {
  proxyUrl: string
  managementKeyFile: string
  feedDirectory: string
  accounts?: readonly UsageAccountConfig[]
  intervalMs?: number
  requestTimeoutMs?: number
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  now?: () => number
}
const usageErrors = defineErrorCatalog('usage-feed', {
  UNSAFE_LOCATION: {
    status: 400,
    message: 'The usage feed needs an isolated local location',
    why: 'Only sanitized feed files can be published, and management reads stay on loopback.',
    fix: 'Choose a dedicated feed directory outside the credential files and a loopback proxy address.',
  },
})
const maxFailures = 10

function report(level: 'warn' | 'info', state: string, count: number) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      source: 'be',
      area: 'claude-gpt',
      operation: 'usage-feed',
      state,
      count,
      why:
        state === 'failing' ? 'The passive usage cache could not be read or published.' : undefined,
      fix:
        state === 'failing'
          ? 'Check local management access and the isolated feed directory.'
          : undefined,
    })}\n`,
  )
}
async function entryAt(filename: string) {
  try {
    return await lstat(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function physicalPath(filename: string): Promise<string> {
  try {
    return await realpath(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const entry = await entryAt(filename)
  if (entry?.isSymbolicLink())
    return physicalPath(resolve(dirname(filename), await readlink(filename)))
  const parent = dirname(filename)
  if (parent === filename)
    throw usageErrors.UNSAFE_LOCATION({ internal: { constraint: 'resolvable-filesystem-root' } })
  return join(await physicalPath(parent), basename(filename))
}
async function prepareDirectory(options: UsageProducerOptions) {
  const url = new URL(options.proxyUrl)
  const requested = resolve(options.feedDirectory)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    (await entryAt(requested))?.isSymbolicLink()
  ) {
    throw usageErrors.UNSAFE_LOCATION({
      internal: { constraint: 'loopback-management-and-direct-feed-root' },
    })
  }
  // Canonicalize ancestors and future paths so temporary-directory aliases stay safe.
  const directory = await physicalPath(requested)
  const keyLocation = relative(directory, await physicalPath(resolve(options.managementKeyFile)))
  const keyInside =
    keyLocation !== '..' && !keyLocation.startsWith(`..${sep}`) && !isAbsolute(keyLocation)
  if (keyInside)
    throw usageErrors.UNSAFE_LOCATION({ internal: { constraint: 'physical-key-outside-feed' } })
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const entries = await readdir(directory, { withFileTypes: true })
  const unsafe = entries.some(
    (entry) =>
      !entry.isFile() || (entry.name !== 'v1.json' && !/^\.v1-[a-f0-9-]+\.tmp$/.test(entry.name)),
  )
  if (unsafe)
    throw usageErrors.UNSAFE_LOCATION({
      internal: { constraint: 'feed-files-only', entryCount: entries.length },
    })
  return directory
}
async function readPrevious(filename: string, accounts: readonly UsageAccountConfig[]) {
  try {
    const file = await open(filename, 'r')
    try {
      const buffer = Buffer.alloc(maxFeedBytes + 1)
      const { bytesRead } = await file.read(buffer)
      if (bytesRead > maxFeedBytes) return null
      return restoreUsageSnapshot(
        JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')),
        accounts,
      )
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}
async function publish(directory: string, snapshot: UsageSnapshot) {
  const text = `${JSON.stringify(snapshot)}\n`
  if (Buffer.byteLength(text) > maxFeedBytes) return false
  const temporary = join(directory, `.v1-${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(text)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, join(directory, 'v1.json'))
    return true
  } catch {
    return false
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolvePromise, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}
async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await withAbort(reader.read(), signal)
      if (chunk.done) return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown
      length += chunk.value.byteLength
      if (length > maxFeedBytes) return null
      chunks.push(chunk.value)
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
}

export async function createUsageProducer(options: UsageProducerOptions) {
  const directory = await prepareDirectory(options)
  const accounts = v.parse(usageAccountsSchema, options.accounts ?? configuredAccounts)
  const now = options.now ?? (() => Date.now())
  const isoNow = () => new Date(now()).toISOString()
  let snapshot =
    (await readPrevious(join(directory, 'v1.json'), accounts)) ??
    createUsageSnapshot(accounts, isoNow())
  const intervalMs = Math.max(60_000, options.intervalMs ?? 60_000)
  const shutdown = new AbortController()
  let writing: Promise<boolean> | undefined
  let queued: UsageSnapshot | undefined
  let pending: Promise<boolean> | undefined
  let lastAttempt = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  let started = false
  let failures = 0

  async function drainPublications() {
    let ok = true
    while (queued) {
      const next = queued
      queued = undefined
      ok = (await publish(directory, { ...next, generatedAt: isoNow() })) && ok
    }
    return ok
  }
  function queuePublication(next: UsageSnapshot) {
    snapshot = next
    queued = next
    if (writing) return
    // Keep at most the current write and the newest pending observation.
    writing = Promise.resolve()
      .then(drainPublications)
      .finally(() => {
        writing = undefined
        if (queued) queuePublication(queued)
      })
  }
  async function flush() {
    let ok = true
    while (writing) ok = (await writing) && ok
    return ok
  }
  queuePublication(snapshot)
  await flush()
  async function sample() {
    const deadline = new AbortController()
    const timeout = setTimeout(() => deadline.abort(), options.requestTimeoutMs ?? 5_000)
    const signal = AbortSignal.any([shutdown.signal, deadline.signal])
    try {
      const key = (await withAbort(Bun.file(options.managementKeyFile).text(), signal)).trim()
      const response = await withAbort(
        (options.fetcher ?? fetch)(new URL('/v0/management/auth-files', options.proxyUrl), {
          method: 'GET',
          headers: { authorization: `Bearer ${key}` },
          redirect: 'error',
          signal,
        }),
        signal,
      )
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        return false
      }
      const body = await readBody(response, signal)
      if (signal.aborted) return false
      const next = normalizeProxySnapshot(body, snapshot, isoNow())
      if (!next) return false
      queuePublication(next)
      return await flush()
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }
  function poll(): Promise<boolean> {
    if (shutdown.signal.aborted) return Promise.resolve(false)
    if (pending) return pending
    if (now() - lastAttempt < intervalMs) return Promise.resolve(false)
    lastAttempt = now()
    pending = sample().finally(() => {
      pending = undefined
    })
    return pending
  }
  async function tick() {
    const ok = await poll()
    if (shutdown.signal.aborted) return
    if (ok) {
      if (failures) report('info', 'recovered', failures)
      failures = 0
    } else {
      failures++
      if (failures === 1) report('warn', 'failing', failures)
      if (failures >= maxFailures) {
        report('warn', 'gave-up', failures)
        return
      }
    }
    timer = setTimeout(tick, intervalMs)
  }
  return {
    poll,
    start() {
      if (started || shutdown.signal.aborted) return
      started = true
      timer = setTimeout(tick, 0)
    },
    observeClaude(headers: Headers) {
      if (shutdown.signal.aborted) return
      const next = observeClaudeHeaders(snapshot, headers, isoNow())
      if (next !== snapshot) queuePublication(next)
    },
    flush,
    async stop() {
      clearTimeout(timer)
      shutdown.abort()
      await pending
      await flush()
    },
  }
}
