import * as v from 'valibot'
import { worktreeIdSchema, sessionIdSchema } from './chat-ids'
import { isRecord } from '@workspace/utils/objects'

export const TERMINAL_MIN_COLS = 2
export const TERMINAL_MAX_COLS = 500
export const TERMINAL_MIN_ROWS = 1
export const TERMINAL_MAX_ROWS = 200

export const terminalOpenInputSchema = v.object({
  worktreeId: worktreeIdSchema,
  agentSessionId: v.optional(sessionIdSchema),
  terminalId: v.pipe(v.string(), v.trim(), v.minLength(1)),
  cols: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(TERMINAL_MIN_COLS), v.maxValue(TERMINAL_MAX_COLS)),
  ),
  rows: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(TERMINAL_MIN_ROWS), v.maxValue(TERMINAL_MAX_ROWS)),
  ),
})

export type TerminalOpenInput = v.InferOutput<typeof terminalOpenInputSchema>

export const terminalKillInputSchema = v.object({
  worktreeId: worktreeIdSchema,
  terminalId: v.pipe(v.string(), v.trim(), v.minLength(1)),
})

export const terminalClearInputSchema = v.pick(terminalOpenInputSchema, [
  'worktreeId',
  'terminalId',
])
export const terminalRestartInputSchema = v.pick(terminalOpenInputSchema, [
  'worktreeId',
  'terminalId',
])
export type TerminalRestartInput = v.InferOutput<typeof terminalRestartInputSchema>
export type TerminalClearInput = v.InferOutput<typeof terminalClearInputSchema>

export type TerminalKillInput = v.InferOutput<typeof terminalKillInputSchema>

export type TerminalClientMessage =
  | { type: 'input'; data: Uint8Array }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'dispose' }

export type TerminalServerMessage =
  | { type: 'ready'; shell: string; cwd: string; restoredHistory: boolean }
  | { type: 'cleared' }
  | { type: 'output'; data: Uint8Array }
  | { type: 'exit'; exitCode: number | null }
  | { type: 'error'; message: string }
  | { type: 'process'; name: string | null }

export function parseTerminalClientMessage(value: unknown): TerminalClientMessage | null {
  const bytes = terminalBytes(value)
  if (bytes) return { type: 'input', data: bytes }
  const parsed = parseJsonValue(value)
  if (!isRecord(parsed)) return null
  if (parsed.type === 'resize') return terminalResizeMessage(parsed)
  if (parsed.type === 'dispose') return { type: 'dispose' }

  return null
}

export function parseTerminalServerMessage(value: unknown): TerminalServerMessage | null {
  const bytes = terminalBytes(value)
  if (bytes) return { type: 'output', data: bytes }
  const parsed = parseJsonValue(value)
  if (!isRecord(parsed)) return null
  if (parsed.type === 'cleared') return { type: 'cleared' }
  if (parsed.type === 'ready') return terminalReadyMessage(parsed)
  if (parsed.type === 'exit') return terminalExitMessage(parsed)
  if (parsed.type === 'error') return terminalErrorMessage(parsed)
  if (parsed.type === 'process') return terminalProcessMessage(parsed)

  return null
}

export function normalizeTerminalCols(value: unknown) {
  return normalizeTerminalDimension(value, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS)
}

export function normalizeTerminalRows(value: unknown) {
  return normalizeTerminalDimension(value, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS)
}

function terminalBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

function terminalResizeMessage(value: Record<string, unknown>): TerminalClientMessage | null {
  const cols = normalizeTerminalCols(value.cols)
  const rows = normalizeTerminalRows(value.rows)
  if (cols === null || rows === null) return null

  return { type: 'resize', cols, rows }
}

function terminalReadyMessage(value: Record<string, unknown>): TerminalServerMessage | null {
  if (typeof value.shell !== 'string') return null
  if (typeof value.cwd !== 'string') return null

  if (typeof value.restoredHistory !== 'boolean') return null
  return {
    type: 'ready',
    shell: value.shell,
    cwd: value.cwd,
    restoredHistory: value.restoredHistory,
  }
}

function terminalExitMessage(value: Record<string, unknown>): TerminalServerMessage | null {
  if (value.exitCode !== null && typeof value.exitCode !== 'number') return null
  if (typeof value.exitCode === 'number' && !Number.isFinite(value.exitCode)) return null

  return { type: 'exit', exitCode: value.exitCode }
}

function terminalErrorMessage(value: Record<string, unknown>): TerminalServerMessage | null {
  if (typeof value.message !== 'string') return null

  return { type: 'error', message: value.message }
}

function terminalProcessMessage(value: Record<string, unknown>): TerminalServerMessage | null {
  if (value.name !== null && typeof value.name !== 'string') return null

  return { type: 'process', name: value.name }
}

function normalizeTerminalDimension(value: unknown, min: number, max: number) {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null

  return Math.max(min, Math.min(max, Math.floor(value)))
}

function parseJsonValue(value: unknown) {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}
