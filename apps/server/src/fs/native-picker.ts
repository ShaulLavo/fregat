import { existsSync } from 'node:fs'
import {
  nativePickerRequestSchema,
  nativePickerResultSchema,
  type NativePickerResult,
} from '@workspace/contracts'
import * as v from 'valibot'
import { systemErrors } from '../system/structured-errors'

type NativePickerBudget = { dialogMs: number; stopGraceMs: number }

export type NativePickerOptions = {
  /** The native helper binary that speaks `pick <options-json>`, or null when none is installed. */
  helper: () => string | null
  /** Whether a signed-in desktop session can show a chooser. */
  desktop: () => boolean
  budget: () => NativePickerBudget
}

const CANCELLED: NativePickerResult = { outcome: 'cancelled', paths: [] }

/** Runs the machine's native chooser, one at a time, owning the helper process until it exits. */
export class NativePicker {
  private active = false
  private readonly options: NativePickerOptions

  constructor(options: NativePickerOptions) {
    this.options = options
  }

  available() {
    const helper = this.options.helper()
    return helper !== null && existsSync(helper) && this.options.desktop()
  }

  async pick(input: unknown, signal: AbortSignal): Promise<NativePickerResult> {
    const parsed = v.safeParse(nativePickerRequestSchema, input)
    if (!parsed.success)
      throw systemErrors.NATIVE_PICKER_INVALID_OPTIONS({
        internal: { field: v.getDotPath(parsed.issues[0]) ?? 'body', issues: parsed.issues.length },
      })
    const helper = this.options.helper()
    if (!helper || !this.available())
      throw systemErrors.NATIVE_PICKER_UNAVAILABLE({
        internal: { helper: helper !== null, desktop: this.options.desktop() },
      })
    if (this.active) throw systemErrors.NATIVE_PICKER_BUSY({ internal: { active: true } })
    this.active = true
    try {
      return await this.run(helper, parsed.output, signal)
    } finally {
      this.active = false
    }
  }

  private async run(helper: string, request: unknown, signal: AbortSignal) {
    const budget = this.options.budget()
    const child = Bun.spawn({
      cmd: [helper, 'pick', JSON.stringify(request)],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = new Response(child.stdout).text()
    const stderrBytes = new Response(child.stderr).arrayBuffer().then((bytes) => bytes.byteLength)
    const deadline = AbortSignal.timeout(budget.dialogMs)
    const stopped = AbortSignal.any([signal, deadline])
    const exitCode = await Promise.race([child.exited, abortion(stopped)])
    if (exitCode === null) {
      await stop(child, budget.stopGraceMs)
      if (signal.aborted) return CANCELLED
      throw systemErrors.NATIVE_PICKER_TIMEOUT({ internal: { dialogMs: budget.dialogMs } })
    }
    const result = pickedResult(await output)
    if (!result)
      throw systemErrors.NATIVE_PICKER_FAILED({
        internal: { exitCode, stderrBytes: await stderrBytes },
      })
    return result
  }
}

function abortion(signal: AbortSignal) {
  return new Promise<null>((resolve) => {
    if (signal.aborted) resolve(null)
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })
}

async function stop(child: Bun.Subprocess, graceMs: number) {
  child.kill('SIGTERM')
  const exited = await Promise.race([child.exited, Bun.sleep(graceMs).then(() => null)])
  if (exited !== null) return
  child.kill('SIGKILL')
  await child.exited
}

function pickedResult(output: string): NativePickerResult | null {
  for (const line of output.split('\n')) {
    const event = parseLine(line)
    if (!event || event.event !== 'picked' || !Array.isArray(event.paths)) continue
    const outcome = event.paths.length === 0 ? 'cancelled' : 'selected'
    const parsed = v.safeParse(nativePickerResultSchema, { outcome, paths: event.paths })
    return parsed.success ? parsed.output : null
  }
  return null
}

function parseLine(line: string): { event?: unknown; paths?: unknown } | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? value : null
  } catch {
    return null
  }
}
