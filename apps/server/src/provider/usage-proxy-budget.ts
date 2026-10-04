import { readFileSync, statSync } from 'node:fs'
import * as v from 'valibot'
import { nodeErrorCode, type ProviderAccountUsage } from '@workspace/contracts'
import { writeFileAtomicSync } from '../fs/atomic-write'
import { tryFileLock, type FileLock } from '../system/file-lock'
import { recordChatPipelineWarning } from '../orchestration/orchestration-logging'

const HOUR_MS = 3_600_000
export const CODEX_USAGE_MAX_FAILURES = 3
const keySchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))
const budgetSchema = v.object({
  version: v.literal(1),
  identityContextHash: keySchema,
  aliases: v.optional(v.record(keySchema, keySchema), () => ({})),
  accounts: v.record(
    keySchema,
    v.object({
      attemptedAt: v.pipe(v.number(), v.finite(), v.minValue(0)),
      nextAttemptAt: v.pipe(v.number(), v.finite(), v.minValue(0)),
      failures: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(0),
        v.maxValue(CODEX_USAGE_MAX_FAILURES),
      ),
      passiveAt: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
      intervalMs: v.optional(v.pipe(v.number(), v.finite(), v.minValue(1))),
    }),
  ),
})
type Budget = v.InferOutput<typeof budgetSchema>
export type ProxyUsageReservation = { key: string; attemptedAt: number; failures: number }
export type ProxyUsageRefresh = {
  staleAfterMs: number
  isCurrent(): boolean
  latest(account: ProviderAccountUsage): ProviderAccountUsage | undefined
  nativeReadPending(account: ProviderAccountUsage): boolean
  requestIntervalMs(account: ProviderAccountUsage): number
  link(key: string, proof: string): boolean
  reserve(key: string, passiveAt: number | null, intervalMs: number): ProxyUsageReservation | null
  settle(reservation: ProxyUsageReservation, success: boolean): void
}

/** A durable reservation precedes transport, so failed and interrupted requests count too. */
export class CodexUsageRequestBudget {
  private warned = false
  private readonly file: string | undefined
  private readonly now: () => number
  private readonly intervalHours: () => number
  private readonly identityContextHash: string

  constructor(
    file: string | undefined,
    now: () => number,
    intervalHours: () => number,
    identityContextHash: string,
  ) {
    this.file = file
    this.now = now
    this.intervalHours = intervalHours
    this.identityContextHash = identityContextHash
  }

  link(key: string, proof: string): boolean {
    return (
      this.update((budget) => {
        const previousKey = budget.aliases[key] ?? key
        const previous = budget.accounts[previousKey]
        const known = budget.accounts[proof]
        if (previous && previousKey !== proof) {
          budget.accounts[proof] = known
            ? {
                attemptedAt: Math.max(previous.attemptedAt, known.attemptedAt),
                nextAttemptAt: Math.max(previous.nextAttemptAt, known.nextAttemptAt),
                failures: Math.min(CODEX_USAGE_MAX_FAILURES, previous.failures + known.failures),
                passiveAt: Math.max(previous.passiveAt ?? 0, known.passiveAt ?? 0) || null,
                intervalMs: Math.max(previous.intervalMs ?? 0, known.intervalMs ?? 0) || undefined,
              }
            : previous
        }
        if (previousKey === key && key !== proof) delete budget.accounts[key]
        budget.aliases[key] = proof
        return true
      }) === true
    )
  }

  reserve(
    key: string,
    passiveAt: number | null,
    requestedIntervalMs?: number,
    deferred?: (key: string, deadline: number) => void,
  ): ProxyUsageReservation | null {
    return this.update((budget) => {
      const canonicalKey = budget.aliases[key] ?? key
      const now = this.now()
      const known = budget.accounts[canonicalKey]
      const configured = this.intervalHours()
      const hours = Number.isFinite(configured) ? Math.max(1, configured) : 1
      const fullIntervalMs = hours * HOUR_MS
      const intervalMs =
        requestedIntervalMs && Number.isFinite(requestedIntervalMs)
          ? Math.min(fullIntervalMs, Math.max(1, requestedIntervalMs))
          : fullIntervalMs
      let failures = known?.failures ?? 0
      if (passiveAt !== null && passiveAt > (known?.passiveAt ?? 0)) failures = 0
      const wait =
        failures >= CODEX_USAGE_MAX_FAILURES
          ? fullIntervalMs
          : Math.min(fullIntervalMs, intervalMs * 2 ** Math.max(0, failures - 1))
      const deadline = known ? known.attemptedAt + wait : now
      const inheritedFloor =
        known && intervalMs >= fullIntervalMs && (known.intervalMs ?? 0) > intervalMs
          ? known.nextAttemptAt
          : deadline
      const nextAttemptAt = Math.max(deadline, inheritedFloor)
      if (now < nextAttemptAt) {
        deferred?.(canonicalKey, nextAttemptAt)
        return null
      }
      if (failures >= CODEX_USAGE_MAX_FAILURES) failures = 0
      budget.accounts[canonicalKey] = {
        attemptedAt: now,
        nextAttemptAt: now + Math.min(fullIntervalMs, intervalMs * 2 ** failures),
        failures: failures + 1,
        passiveAt: passiveAt ?? known?.passiveAt ?? null,
        intervalMs,
      }
      return { key: canonicalKey, attemptedAt: now, failures: failures + 1 }
    })
  }

  settle(reservation: ProxyUsageReservation, success: boolean) {
    return this.update((budget) => {
      const key = budget.aliases[reservation.key] ?? reservation.key
      const known = budget.accounts[key]
      if (known?.attemptedAt !== reservation.attemptedAt || known.failures !== reservation.failures)
        return null
      if (success) {
        known.failures = 0
        known.nextAttemptAt =
          known.attemptedAt + (known.intervalMs ?? this.intervalHours() * HOUR_MS)
      }
      if (known.failures >= CODEX_USAGE_MAX_FAILURES)
        known.nextAttemptAt = known.attemptedAt + this.fullIntervalMs()
      return { key, nextAttemptAt: known.nextAttemptAt }
    })
  }

  private fullIntervalMs() {
    const configured = this.intervalHours()
    return (Number.isFinite(configured) ? Math.max(1, configured) : 1) * HOUR_MS
  }

  private update<T>(apply: (budget: Budget) => T | null): T | null {
    if (!this.file) return null
    let lock: FileLock | null = null
    try {
      lock = tryFileLock(`${this.file}.lock`)
      if (!lock) return null
      const budget = this.read()
      if (!budget) return null
      const result = apply(budget)
      if (result === null) return null
      writeFileAtomicSync(this.file, JSON.stringify(budget), {
        durability: 'fsync-all',
        mode: 0o600,
      })
      return result
    } catch {
      if (!this.warned) {
        this.warned = true
        recordChatPipelineWarning('chat.pipeline.provider_usage.proxy_budget_unavailable', {
          outcome: 'collection-paused',
        })
      }
      return null
    } finally {
      lock?.release()
    }
  }

  private read(): Budget | null {
    try {
      if (statSync(this.file!).size > 1024 * 1024) return v.parse(budgetSchema, null)
      const budget = v.parse(budgetSchema, JSON.parse(readFileSync(this.file!, 'utf8')))
      if (budget.identityContextHash === this.identityContextHash) return budget
      // A new private identity key cannot map old reservations; wait for every deadline first.
      const waiting = Object.values(budget.accounts).some(
        (account) => this.now() < Math.max(account.nextAttemptAt, account.attemptedAt + HOUR_MS),
      )
      return waiting ? null : this.empty()
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return this.empty()
      throw error
    }
  }

  private empty(): Budget {
    return { version: 1, identityContextHash: this.identityContextHash, aliases: {}, accounts: {} }
  }
}
