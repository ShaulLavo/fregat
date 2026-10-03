import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { scriptFailureText } from '../structured-errors'
import { unlessMissing } from './lock'
import { live, type Entry } from './queue'

type Turn = { readonly quietId: string; readonly waitingIds?: readonly string[] }

// All turn operations share admission.lock. The snapshot is finite, so later arrivals cannot
// extend a fair turn indefinitely; their ordinary FIFO positions stay intact.
export function beginQuietTurn(stateDir: string, quietId: string) {
  writeTurn(stateDir, { quietId })
}

export function finishQuietTurn(stateDir: string, quietId: string) {
  const turn = readTurn(stateDir)
  if (!turn || turn.quietId !== quietId || turn.waitingIds !== undefined) return
  writeTurn(stateDir, { quietId, waitingIds: nonQuietIds(live(stateDir, 'queue')) })
}

/** FIFO, with the completed hold's waiting non-quiet cohort ahead of the next quiet job. */
export function turnQueue(
  stateDir: string,
  queue: readonly Entry[],
  owners: readonly Entry[],
  now: number,
): readonly Entry[] {
  const turn = readTurn(stateDir)
  if (!turn) return queue
  const holder = owners.find((entry) => entry.id === turn.quietId)
  if (holder && (holder.quietUntil ?? Infinity) > now) return queue
  // A dead or suspended wrapper may never finish its turn; the next admission snapshots it.
  const waitingIds = turn.waitingIds ?? nonQuietIds(queue)
  if (turn.waitingIds === undefined && !writeTurn(stateDir, { ...turn, waitingIds })) return queue
  const ids = new Set(waitingIds)
  const cohort = queue.filter((entry) => !entry.quiet && ids.has(entry.id))
  if (cohort.length === 0) {
    removeTurn(stateDir)
    return queue
  }
  return [...cohort, ...queue.filter((entry) => !ids.has(entry.id))]
}

function nonQuietIds(queue: readonly Entry[]) {
  return queue.filter((entry) => !entry.quiet).map((entry) => entry.id)
}

function turnFile(stateDir: string) {
  return path.join(stateDir, 'quiet.turn')
}

function readTurn(stateDir: string): Turn | null {
  try {
    const text = unlessMissing(() => readFileSync(turnFile(stateDir), 'utf8'))
    if (text === null) return null
    const turn = parseTurn(text)
    if (turn) return turn
    removeTurn(stateDir)
    console.error('[wave-heavy] ignored invalid fair-turn metadata; FIFO admission continues')
  } catch (error) {
    console.error(
      `[wave-heavy] could not read fair turn; FIFO admission continues: ${scriptFailureText(error)}`,
    )
  }
  return null
}

function parseTurn(text: string): Turn | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || !('quietId' in value)) return null
    if (!isId(value.quietId)) return null
    if (!('waitingIds' in value)) return { quietId: value.quietId }
    if (!Array.isArray(value.waitingIds) || !value.waitingIds.every(isId)) return null
    return { quietId: value.quietId, waitingIds: value.waitingIds }
  } catch {
    return null
  }
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{12}$/.test(value)
}

function removeTurn(stateDir: string) {
  try {
    rmSync(turnFile(stateDir), { force: true })
  } catch (error) {
    console.error(
      `[wave-heavy] could not remove fair turn; FIFO admission continues: ${scriptFailureText(error)}`,
    )
  }
}

function writeTurn(stateDir: string, turn: Turn) {
  const file = turnFile(stateDir)
  const partial = `${file}.partial`
  try {
    writeFileSync(partial, JSON.stringify(turn))
    renameSync(partial, file)
    return true
  } catch (error) {
    removeTurn(stateDir)
    console.error(
      `[wave-heavy] could not save fair turn; FIFO admission continues: ${scriptFailureText(error)}`,
    )
    return false
  }
}
