import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { spawnHost, type HostProcess } from '../native-helper'
import { pick, runNativeDialog } from '../webview-host'
import { launcherFailureFacts } from '../failure'

const fixture = path.join(import.meta.dirname, 'fixtures/native-helper.mjs')
const budget = { dialogMs: 200, stopGraceMs: 20 }

test.each(['cancel', 'success', 'message', 'malformed', 'error', 'timeout', 'abort'] as const)(
  'owns and reaps the native %s helper while preserving an unrelated fixture process',
  async (behavior) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'native-helper-test-'))
    const pidFile = path.join(directory, 'pid')
    const other = spawnHost([process.execPath, fixture, path.join(directory, 'other'), 'timeout'])
    const abort = new AbortController()
    let owned: HostProcess | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const spawn = () => {
      owned = spawnHost([process.execPath, fixture, pidFile, behavior])
      return owned
    }
    try {
      await expect.poll(() => existsSync(path.join(directory, 'other'))).toBe(true)
      if (behavior === 'abort') timer = setTimeout(() => abort.abort(), 100)
      const options = { binary: '/fixture/native', budget, signal: abort.signal, spawn }
      const operation =
        behavior === 'message'
          ? runNativeDialog({ ...options, args: ['message', '/fixture/public-message'] })
          : pick({ ...options, options: {} })
      if (behavior === 'cancel') expect(await operation).toEqual([])
      else if (behavior === 'success') expect(await operation).toEqual(['/fixture/資料'])
      else if (behavior === 'message') expect(await operation).toEqual([{ event: 'closed' }])
      else {
        const failure = await operation.catch((error: unknown) => error)
        expect(failure).toBeDefined()
        expect(JSON.stringify(launcherFailureFacts(failure))).not.toContain('private file content')
        if (behavior === 'error')
          expect(launcherFailureFacts(failure).internal).toMatchObject({
            code: 7,
            stderrBytes: Buffer.byteLength('private file content and secret\n'),
          })
      }
      expect(owned).toBeDefined()
      await owned!.exited
      const pid = readFileSync(pidFile, 'utf8')
      expect(existsSync(`/proc/${pid}`)).toBe(false)
      expect(existsSync(`/proc/${readFileSync(path.join(directory, 'other'), 'utf8')}`)).toBe(true)
    } finally {
      clearTimeout(timer)
      owned?.kill('SIGKILL')
      other.kill('SIGKILL')
      await Promise.allSettled([owned?.exited, other.exited])
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
