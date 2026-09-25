import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

/**
 * Restarts a Bun entry as a new process when its sources change. `bun --watch` re-evaluates the
 * module inside the same process, so children spawned before a reload are never reaped and pile up
 * as zombies; a new process lets the old one's children go to init, which reaps them.
 */

const STOP_GRACE_MS = 5_000
const DEBOUNCE_MS = 100
const IGNORED = /(?:^|\/)(?:node_modules|dist|tests?|\.[^/]+)(?:\/|$)|\.test\.tsx?$/

export type Supervisor = {
  readonly restarts: () => number
  readonly pid: () => number | undefined
  restart(reason: string): Promise<void>
  stop(): Promise<void>
}

export function superviseEntry(entry: string, watchDirs: readonly string[]): Supervisor {
  let child: Bun.Subprocess | null = null
  let restarts = 0
  let pending: ReturnType<typeof setTimeout> | null = null
  let queue = Promise.resolve()
  let stopped = false

  const start = () => {
    child = Bun.spawn([process.execPath, entry], {
      env: process.env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
  }

  const restart = (reason: string) => {
    queue = queue.then(async () => {
      if (stopped) return
      console.log(`[restart-on-change] ${reason}; restarting`)
      await stopChild(child)
      restarts += 1
      start()
    })
    return queue
  }

  const watchers: FSWatcher[] = watchDirs.map((dir) =>
    watch(dir, { recursive: true }, (_event, file) => {
      if (!file || IGNORED.test(file) || !/\.(?:ts|tsx|json)$/.test(file)) return
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => void restart(path.join(dir, file)), DEBOUNCE_MS)
    }),
  )

  start()
  return {
    restarts: () => restarts,
    pid: () => child?.pid,
    restart,
    async stop() {
      stopped = true
      if (pending) clearTimeout(pending)
      for (const watcher of watchers) watcher.close()
      await queue
      await stopChild(child)
    },
  }
}

async function stopChild(child: Bun.Subprocess | null) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(STOP_GRACE_MS)])
  if (exited) return
  child.kill('SIGKILL')
  await child.exited
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { watch: { type: 'string', multiple: true } },
  })
  const entry = positionals[0]
  if (!entry) {
    console.error('Usage: bun restart-on-change.ts <entry> [--watch <dir>]…')
    process.exit(1)
  }
  const supervisor = superviseEntry(entry, values.watch ?? [path.dirname(entry)])
  const shutdown = () => void supervisor.stop().then(() => process.exit(0))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
