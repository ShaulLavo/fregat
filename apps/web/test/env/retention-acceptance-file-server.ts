import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createScriptError } from '../../../../scripts/structured-errors'
import type { TestProject } from 'vitest/node'
import setupBrowserFileServer from './browser-file-server'
import {
  createRetentionEntryCapture,
  registerRetentionEntryCapture,
  releaseRetentionEntryCapture,
  guardRetentionEntryObservation,
  retentionEntryReceiptTime,
} from '../factories/retention-acceptance-reload-transport'

const entries = new Map<string, { ready: Promise<() => Promise<void>>; users: number }>()

export default async function setupRetentionAcceptanceFileServer(project: TestProject) {
  const url = project.getProvidedContext().retentionAcceptanceEntryUrl
  let entry = entries.get(url)
  if (!entry) {
    entry = { ready: startRetentionAcceptanceFileServer(project), users: 0 }
    entries.set(url, entry)
  }
  entry.users += 1
  const stop = await entry.ready
  return async () => {
    entry.users -= 1
    if (entry.users > 0) return
    entries.delete(url)
    await stop()
  }
}

async function startRetentionAcceptanceFileServer(project: TestProject) {
  const entry = new URL(project.getProvidedContext().retentionAcceptanceEntryUrl)
  const stopFixture = await setupBrowserFileServer()
  const server = spawn(
    'bun',
    [
      'x',
      '--no-install',
      'vite',
      '--config',
      fileURLToPath(new URL('../../retention-acceptance.vitest.config.ts', import.meta.url)),
      '--mode',
      'retention-acceptance-entry',
      '--host',
      entry.hostname,
      '--port',
      entry.port,
      '--strictPort',
    ],
    {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const capture = createRetentionEntryCapture()
  registerRetentionEntryCapture(entry.origin, capture)
  const note = (event: object) =>
    capture.accept({ ...retentionEntryReceiptTime(), childPid: server.pid, ...event })
  guardRetentionEntryObservation(() => note({ kind: 'process-start' }))
  server.once('exit', (exitCode, signal) =>
    guardRetentionEntryObservation(() => note({ kind: 'process-exit', exitCode, signal })),
  )
  const output: string[] = []
  server.stdout.on('data', (data: Buffer) => capture.read(data, (value) => output.push(value)))
  server.stdout.once('end', () => capture.finishWire())
  server.stderr.on('data', (data: Buffer) => output.push(data.toString()))
  const stopServer = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
    guardRetentionEntryObservation(() => note({ kind: 'process-stop', signal: 'SIGTERM' }))
    server.kill('SIGTERM')
    const timer = setTimeout(() => {
      guardRetentionEntryObservation(() => note({ kind: 'process-stop', signal: 'SIGKILL' }))
      server.kill('SIGKILL')
    }, 5000)
    await exited
    clearTimeout(timer)
  }
  try {
    const deadline = Date.now() + 15_000
    let ready = false
    while (!ready && Date.now() < deadline) {
      if (server.exitCode !== null || server.signalCode !== null) break
      ready = await fetch(entry).then(
        (response) => response.ok,
        () => false,
      )
      if (!ready) await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    if (!ready)
      throw createScriptError('Retention entry server failed to start', {
        internal: { output: output.join('') },
      })
  } catch (error) {
    await stopServer()
    await stopFixture()
    releaseRetentionEntryCapture(entry.origin)
    throw error
  }
  return async () => {
    try {
      await stopServer()
    } finally {
      try {
        await stopFixture()
      } finally {
        await persistRetentionEntryFailures(capture)
        releaseRetentionEntryCapture(entry.origin)
      }
    }
  }
}

async function persistRetentionEntryFailures(
  capture: ReturnType<typeof createRetentionEntryCapture>,
) {
  try {
    const results = await capture.persistFailures()
    for (const result of results) {
      if (result.status === 'written') continue
      guardRetentionEntryObservation(() =>
        console.warn('retention-entry-persistence ' + JSON.stringify(result)),
      )
    }
  } catch {
    guardRetentionEntryObservation(() =>
      console.warn('retention-entry-persistence {"status":"unavailable","codes":[null]}'),
    )
  }
}
