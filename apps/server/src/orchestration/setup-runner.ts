import type { WorktreeId } from '@workspace/contracts'

/** Dependency installs are slow and healthy; a setup that never exits is not. */
export const SETUP_TIMEOUT_MS = 30 * 60_000
const OUTPUT_LINES = 40
const LINE_LENGTH = 400
const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[ -/]*[@-~]`, 'g')

export type SetupOutcome = {
  state: 'done' | 'failed' | 'cancelled'
  exitCode: number | null
  output: string[]
}

type Control = { cancelled: boolean; killTimer: ReturnType<typeof setTimeout> | null }
type Running = { child: Bun.Subprocess | null; control: Control; finished: Promise<SetupOutcome> }

/**
 * Runs a project's setup script in a worktree as a process this server owns: one at a time per
 * worktree, killed on cancel, on worktree removal and at shutdown. The working directory is fixed
 * when it starts, so a later worktree switch cannot move it.
 */
export class SetupRunner {
  private readonly running = new Map<WorktreeId, Running>()

  isRunning(worktreeId: WorktreeId) {
    return this.running.has(worktreeId)
  }

  run(
    worktreeId: WorktreeId,
    input: { command: string; worktreePath: string; projectRoot: string },
    beforeSpawn: () => Promise<unknown>,
  ): Promise<SetupOutcome> {
    const existing = this.running.get(worktreeId)
    if (existing) return existing.finished
    const control: Control = { cancelled: false, killTimer: null }
    const finished = Promise.resolve()
      .then(async (): Promise<SetupOutcome> => {
        await beforeSpawn()
        if (control.cancelled) return { state: 'cancelled', exitCode: null, output: [] }
        const child = this.spawn(input)
        entry.child = child
        return this.watch(child, control)
      })
      .finally(() => this.running.delete(worktreeId))
    const entry: Running = { child: null, control, finished }
    this.running.set(worktreeId, entry)
    return entry.finished
  }

  private spawn(input: { command: string; worktreePath: string; projectRoot: string }) {
    return Bun.spawn(['sh', '-c', input.command], {
      cwd: input.worktreePath,
      env: {
        ...process.env,
        PLATFORM_PROJECT_ROOT: input.projectRoot,
        PLATFORM_WORKTREE_PATH: input.worktreePath,
        // Scripts imported from t3.json read these names.
        T3CODE_PROJECT_ROOT: input.projectRoot,
        T3CODE_WORKTREE_PATH: input.worktreePath,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      // Its own process group, so a cancel reaches whatever the script started.
      detached: true,
    })
  }

  /** Stops a running setup and waits for it to be gone. */
  async cancel(worktreeId: WorktreeId) {
    const entry = this.running.get(worktreeId)
    if (!entry) return
    entry.control.cancelled = true
    if (entry.child) terminate(entry.child, entry.control)
    await entry.finished
  }

  async close() {
    await Promise.all([...this.running.keys()].map((worktreeId) => this.cancel(worktreeId)))
  }

  private async watch(
    child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
    control: Control,
  ): Promise<SetupOutcome> {
    const output: string[] = []
    const timer = setTimeout(() => terminate(child, control), SETUP_TIMEOUT_MS)
    try {
      await Promise.all([collect(child.stdout, output), collect(child.stderr, output)])
      const exitCode = await child.exited
      if (control.cancelled) return { state: 'cancelled', exitCode: null, output }
      return { state: exitCode === 0 ? 'done' : 'failed', exitCode, output }
    } finally {
      clearTimeout(timer)
      if (control.killTimer) clearTimeout(control.killTimer)
    }
  }
}

async function collect(stream: ReadableStream<Uint8Array>, output: string[]) {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true })
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) keep(output, line)
  }
  if (buffered) keep(output, buffered)
}

function keep(output: string[], line: string) {
  const clean = line.replace(ANSI, '').slice(0, LINE_LENGTH)
  if (!clean.trim()) return
  output.push(clean)
  if (output.length > OUTPUT_LINES) output.shift()
}

function terminate(child: Bun.Subprocess, control: Control) {
  if (control.killTimer) return
  killGroup(child, 'SIGTERM')
  control.killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), 500)
}

function killGroup(child: Bun.Subprocess, signal: NodeJS.Signals) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    if (child.exitCode === null) child.kill(signal)
  }
}
