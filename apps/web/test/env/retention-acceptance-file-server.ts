import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createScriptError } from '../../../../scripts/structured-errors'
import type { TestProject } from 'vitest/node'
import setupBrowserFileServer from './browser-file-server'

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
  const output: string[] = []
  server.stdout.on('data', (data: Buffer) => output.push(data.toString()))
  server.stderr.on('data', (data: Buffer) => output.push(data.toString()))
  const stopServer = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
    server.kill('SIGTERM')
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000)
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
    throw error
  }
  return async () => {
    try {
      await stopServer()
    } finally {
      await stopFixture()
    }
  }
}
