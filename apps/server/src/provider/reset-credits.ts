import * as v from 'valibot'
import { providerResetCreditBodySchema } from '@workspace/contracts'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { and, eq } from 'drizzle-orm'
import type {
  ProviderInstanceId,
  ProviderResetCreditBody,
  ProviderResetCreditResult,
} from '@workspace/contracts'
import type { PlatformDatabase } from '../db/client'
import { providerResetCreditAttempts } from '../db/schema'
import { createStructuredError } from '../observability/structured-errors'
import type { ProviderAdapterRegistry } from './provider-adapter-registry'
import type { ProviderUsageStore } from './usage-store'

type Registry = Pick<ProviderAdapterRegistry, 'adapter' | 'usageAccount'>

export class ProviderResetCredits {
  private readonly client = new QueryClient()

  private readonly database: PlatformDatabase
  private readonly registry: Registry
  private readonly usage: Pick<ProviderUsageStore, 'read' | 'refreshAccount'>
  private readonly now: () => number

  constructor(
    database: PlatformDatabase,
    registry: Registry,
    usage: Pick<ProviderUsageStore, 'read' | 'refreshAccount'>,
    now: () => number = Date.now,
  ) {
    this.database = database
    this.registry = registry
    this.usage = usage
    this.now = now
  }

  async redeem(instanceId: ProviderInstanceId, input: ProviderResetCreditBody) {
    v.parse(providerResetCreditBodySchema, input)
    this.target(instanceId)
    const observer = new MutationObserver(this.client, {
      mutationKey: ['provider', 'reset-credit', input.accountKey],
      scope: { id: `reset-credit:${input.accountKey}` },
      mutationFn: () => this.run(instanceId, input),
      retry: false,
    })
    return observer.mutate()
  }

  async readUsage() {
    const usage = await this.usage.read()
    return {
      accounts: usage.accounts.map((account) => {
        const attempt = this.database
          .select()
          .from(providerResetCreditAttempts)
          .where(eq(providerResetCreditAttempts.accountKey, account.resetCredits?.accountKey ?? ''))
          .get()
        const pending = attempt?.outcome === null
        return {
          ...account,
          resetPending: pending,
          resetCredits:
            pending && account.resetCredits
              ? { ...account.resetCredits, creditId: attempt.creditId }
              : account.resetCredits,
        }
      }),
    }
  }

  close() {
    this.client.clear()
  }

  private target(instanceId: ProviderInstanceId) {
    const account = this.registry.usageAccount(instanceId)
    const adapter = this.registry.adapter(instanceId)
    if (!account?.enabled || !adapter?.consumeResetCredit || !adapter.readUsage)
      throw resetError('UNAVAILABLE', 'Reset credits are unavailable for this provider.', 409)
    return {
      consume: adapter.consumeResetCredit.bind(adapter),
      read: adapter.readUsage.bind(adapter),
      credentialAccountKey: account.accountKey,
    }
  }

  private attempt(input: ProviderResetCreditBody, availableCredit: string | null) {
    if (Date.parse(input.checkedAt) > this.now())
      throw resetError('STALE_CONFIRMATION', 'Refresh usage before confirming a reset.', 409)
    return this.database.transaction((tx) => {
      const previous = tx
        .select()
        .from(providerResetCreditAttempts)
        .where(eq(providerResetCreditAttempts.accountKey, input.accountKey))
        .get()
      // An unresolved attempt keeps its native key across retries and server restarts.
      if (
        previous &&
        (!previous.settledAt || Date.parse(input.checkedAt) <= Date.parse(previous.settledAt))
      )
        return previous
      if (availableCredit !== input.creditId)
        throw resetError(
          'UNAVAILABLE',
          'This reset credit is no longer available. Refresh usage.',
          409,
        )
      const next = {
        accountKey: input.accountKey,
        creditId: input.creditId,
        idempotencyKey: crypto.randomUUID(),
        confirmedAt: input.checkedAt,
        outcome: null,
        settledAt: null,
      }
      tx.insert(providerResetCreditAttempts)
        .values(next)
        .onConflictDoUpdate({ target: providerResetCreditAttempts.accountKey, set: next })
        .run()
      return next
    })
  }

  private async run(
    instanceId: ProviderInstanceId,
    input: ProviderResetCreditBody,
  ): Promise<ProviderResetCreditResult> {
    const target = this.target(instanceId)
    const reading = await target.read().catch(() => null)
    if (reading?.kind !== 'reading' || reading.resetCredits?.accountKey !== input.accountKey)
      throw resetError(
        'ACCOUNT_CHANGED',
        'The signed-in account changed. Refresh usage before confirming a reset.',
        409,
      )
    const attempt = this.attempt(
      input,
      reading.resetCredits.available > 0 ? reading.resetCredits.creditId : null,
    )
    let outcome = attempt.outcome
    if (outcome === null) {
      try {
        outcome = await target.consume({
          idempotencyKey: attempt.idempotencyKey,
          accountKey: input.accountKey,
          creditId: attempt.creditId,
        })
      } catch {
        // A transport failure cannot tell whether the provider spent the credit.
        throw resetError(
          'UNCONFIRMED',
          'The reset outcome is unconfirmed. Retry to check the same attempt.',
          503,
        )
      }
      this.database
        .update(providerResetCreditAttempts)
        .set({ outcome, settledAt: new Date(this.now()).toISOString() })
        .where(
          and(
            eq(providerResetCreditAttempts.accountKey, input.accountKey),
            eq(providerResetCreditAttempts.idempotencyKey, attempt.idempotencyKey),
          ),
        )
        .run()
    }
    const refreshed = await this.usage
      .refreshAccount(target.credentialAccountKey)
      .catch(() => false)
    return {
      outcome,
      refresh: refreshed ? 'confirmed' : 'unconfirmed',
      usage: await this.readUsage(),
    }
  }
}

function resetError(code: string, message: string, status: number) {
  return createStructuredError({
    code: `provider.RESET_CREDIT_${code}`,
    message,
    status,
    why: 'Reset credits change the provider account usage allowance.',
    fix: 'Refresh usage and confirm the account before retrying.',
  })
}
