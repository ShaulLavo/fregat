import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { platformHomePath } from '../home'

const DEFAULT_TTL_MS = 10_000
const MAX_MARKERS = 512

type AppSaveLedger = {
  version: 1
  savedAtByPath: Record<string, number>
}

type AppSaveMarkerOptions = {
  markerPath?: string
  now?: number
  ttlMs?: number
}

export function recordAppSave(absolutePath: string, options: AppSaveMarkerOptions = {}): boolean {
  try {
    const marker = markerPath(options)
    const now = options.now ?? Date.now()
    const ledger = cappedLedger(pruneLedger(readLedger(marker), now, ttlMs(options)))
    ledger.savedAtByPath[normalizeMarkerPath(absolutePath)] = now
    writeLedger(marker, ledger)
    return true
  } catch {
    return false
  }
}

export function consumeAppSave(absolutePath: string, options: AppSaveMarkerOptions = {}): boolean {
  try {
    const marker = markerPath(options)
    if (!existsSync(marker)) {
      return false
    }

    const normalizedPath = normalizeMarkerPath(absolutePath)
    const ledger = pruneLedger(readLedger(marker), options.now ?? Date.now(), ttlMs(options))

    if (ledger.savedAtByPath[normalizedPath] === undefined) {
      writeLedger(marker, ledger)
      return false
    }

    delete ledger.savedAtByPath[normalizedPath]
    writeLedger(marker, ledger)
    return true
  } catch {
    return false
  }
}

export function forgetAppSave(absolutePath: string, options: AppSaveMarkerOptions = {}): void {
  try {
    const marker = markerPath(options)
    if (!existsSync(marker)) {
      return
    }

    const ledger = readLedger(marker)
    delete ledger.savedAtByPath[normalizeMarkerPath(absolutePath)]
    writeLedger(marker, ledger)
  } catch {
    // Save markers are only a dev-server hint; file writes should not fail because of them.
  }
}

function markerPath(options: AppSaveMarkerOptions): string {
  return options.markerPath ?? platformHomePath('app-save-markers.json')
}

function ttlMs(options: AppSaveMarkerOptions): number {
  return options.ttlMs ?? DEFAULT_TTL_MS
}

function emptyLedger(): AppSaveLedger {
  return { version: 1, savedAtByPath: {} }
}

function readLedger(markerPath: string): AppSaveLedger {
  if (!existsSync(markerPath)) {
    return emptyLedger()
  }

  const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as unknown
  return parseLedger(parsed) ?? emptyLedger()
}

function parseLedger(value: unknown): AppSaveLedger | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const ledger = value as Partial<AppSaveLedger>
  if (ledger.version !== 1 || !ledger.savedAtByPath) {
    return undefined
  }

  const entries = Object.entries(ledger.savedAtByPath).filter(
    ([savedPath, savedAt]) => savedPath.length > 0 && typeof savedAt === 'number',
  )
  return { version: 1, savedAtByPath: Object.fromEntries(entries) }
}

function pruneLedger(ledger: AppSaveLedger, now: number, ttlMs: number): AppSaveLedger {
  const savedAtByPath = Object.fromEntries(
    Object.entries(ledger.savedAtByPath).filter(([, savedAt]) => now - savedAt <= ttlMs),
  )
  return { version: 1, savedAtByPath }
}

function cappedLedger(ledger: AppSaveLedger): AppSaveLedger {
  const entries = Object.entries(ledger.savedAtByPath)
  if (entries.length <= MAX_MARKERS) {
    return ledger
  }

  const savedAtByPath = Object.fromEntries(
    entries.sort(([, left], [, right]) => right - left).slice(0, MAX_MARKERS),
  )
  return { version: 1, savedAtByPath }
}

function writeLedger(markerPath: string, ledger: AppSaveLedger): void {
  const directory = path.dirname(markerPath)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(markerPath)}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporaryPath, JSON.stringify(ledger), 'utf8')
    renameSync(temporaryPath, markerPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function normalizeMarkerPath(input: string): string {
  return path.resolve(input)
}
