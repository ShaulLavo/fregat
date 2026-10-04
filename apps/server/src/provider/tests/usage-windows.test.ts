import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderUsageWindow } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'
import {
  claudeUsageProbe,
  claudeUsageUpdate,
  codexUsageUpdate,
  mergeObservedUsageWindows,
  mergeUsageWindows,
  stoppingUsageWindow,
  usageLimitMessage,
} from '../utils/usage-windows'

// 2026-09-24T12:00:00.000Z
const RESET_SECONDS = 1_790_251_200
const RESET_ISO = '2026-09-24T12:00:00.000Z'
const RESET_MS = RESET_SECONDS * 1000

describe('claude rate-limit events', () => {
  it('scales the 0–1 utilization and reads the epoch-second reset', () => {
    expect(
      claudeUsageUpdate(
        {
          rateLimitType: 'seven_day',
          resetsAt: RESET_SECONDS,
          status: 'allowed_warning',
          utilization: 0.85,
        },
        null,
      ),
    ).toEqual({
      planType: null,
      windows: [
        {
          id: 'seven_day',
          kind: 'weekly',
          label: 'Weekly',
          resetsAt: RESET_ISO,
          status: 'warning',
          usedPercent: 85,
          windowMinutes: 10_080,
        },
      ],
    })
  })

  it('keeps an uncovered rejection without inventing a percentage', () => {
    expect(
      claudeUsageUpdate({ rateLimitType: 'five_hour', status: 'rejected' }, null).windows,
    ).toEqual([expect.objectContaining({ status: 'rejected', usedPercent: null })])
  })

  it('keeps the percentage open and only warns when overage pays for the rejection', () => {
    expect(
      claudeUsageUpdate(
        { overageStatus: 'allowed', rateLimitType: 'five_hour', status: 'rejected' },
        null,
      ).windows,
    ).toEqual([expect.objectContaining({ status: 'warning', usedPercent: null })])
  })

  it('names the overage-included bucket after the model get_usage reported, or drops it', () => {
    const info = {
      rateLimitType: 'seven_day_overage_included',
      status: 'allowed',
      utilization: 0.4,
    } as const
    expect(claudeUsageUpdate(info, null).windows).toEqual([])
    expect(claudeUsageUpdate(info, 'Fable').windows).toEqual([
      expect.objectContaining({ id: 'seven_day_fable', label: 'Weekly · Fable', usedPercent: 40 }),
    ])
  })
})

describe('claude get_usage', () => {
  it('reads every window at 0–100, the scoped model and the plan', () => {
    const { probe, scopedModel } = claudeUsageProbe(
      getUsage({
        extra_usage: {
          is_enabled: false,
          monthly_limit: null,
          used_credits: null,
          utilization: null,
        },
        five_hour: { resets_at: '2026-09-24T12:00:00Z', utilization: 54 },
        model_scoped: [
          { display_name: 'Fable', resets_at: null, utilization: 73 },
          { display_name: 'Ghost', resets_at: null, utilization: null },
        ],
        seven_day: { resets_at: null, utilization: 250 },
      }),
    )

    expect(scopedModel).toBe('Fable')
    expect(probe).toEqual({
      kind: 'reading',
      update: {
        planType: 'max',
        windows: [
          expect.objectContaining({ id: 'five_hour', resetsAt: RESET_ISO, usedPercent: 54 }),
          expect.objectContaining({ id: 'seven_day', status: 'rejected', usedPercent: 100 }),
          expect.objectContaining({ id: 'seven_day_fable', label: 'Weekly · Fable' }),
        ],
      },
    })
  })

  it('warns instead of stopping on a full window while extra usage is on', () => {
    const { probe } = claudeUsageProbe(
      getUsage({
        extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 5, utilization: 10 },
        five_hour: { resets_at: null, utilization: 100 },
      }),
    )

    expect(probe.kind === 'reading' && probe.update.windows).toEqual([
      expect.objectContaining({ id: 'five_hour', status: 'warning' }),
      expect.objectContaining({ id: 'extra_usage', kind: 'other', usedPercent: 10 }),
    ])
  })

  it('reports an account without plan limits as unsupported', () => {
    expect(
      claudeUsageProbe({ ...getUsage({}), rate_limits: null, rate_limits_available: false }).probe,
    ).toEqual({ kind: 'unsupported' })
  })
})

describe('codex rate-limit snapshots', () => {
  it('reads kinds from durations and marks a spent window rejected', () => {
    expect(
      codexUsageUpdate({
        limitId: 'codex',
        planType: 'pro',
        primary: { resetsAt: RESET_SECONDS, usedPercent: 100, windowDurationMins: 300 },
        secondary: { usedPercent: 40, windowDurationMins: 10_080 },
      }),
    ).toEqual({
      credits: null,
      planType: 'pro',
      windows: [
        {
          id: 'primary',
          kind: 'session',
          label: 'Session',
          resetsAt: RESET_ISO,
          status: 'rejected',
          usedPercent: 100,
          windowMinutes: 300,
        },
        {
          id: 'secondary',
          kind: 'weekly',
          label: 'Weekly',
          resetsAt: null,
          status: null,
          usedPercent: 40,
          windowMinutes: 10_080,
        },
      ],
    })
  })

  it('warns instead of stopping when credits cover a spent window', () => {
    expect(
      codexUsageUpdate({
        credits: { hasCredits: true, unlimited: false },
        primary: { usedPercent: 100 },
      }).windows[0],
    ).toMatchObject({ status: 'warning' })
  })

  it('retains an unknown duration without guessing from account plan', () => {
    expect(
      codexUsageUpdate({ planType: 'free', primary: { usedPercent: 12 } }).windows[0],
    ).toMatchObject({ kind: 'other', label: 'Other', windowMinutes: null })
    expect(codexUsageUpdate({ planType: 'unknown', primary: { usedPercent: 1 } }).planType).toBe(
      null,
    )
  })

  it('ignores a model-specific allowance', () => {
    expect(
      codexUsageUpdate({ limitId: 'codex_spark', primary: { usedPercent: 90 } }).windows,
    ).toEqual([])
  })
})

describe('mergeUsageWindows', () => {
  const session: ProviderUsageWindow = {
    id: 'five_hour',
    kind: 'session',
    label: 'Session',
    resetsAt: RESET_ISO,
    status: 'allowed',
    usedPercent: 20,
    windowMinutes: 300,
  }
  const weekly: ProviderUsageWindow = {
    id: 'seven_day',
    kind: 'weekly',
    label: 'Weekly',
    resetsAt: null,
    status: 'allowed',
    usedPercent: 50,
    windowMinutes: 10_080,
  }

  it('upserts by id, keeps omitted windows and a known reset, and orders by kind', () => {
    expect(
      mergeUsageWindows([weekly, session], [{ ...session, resetsAt: null, usedPercent: 30 }]),
    ).toEqual([{ ...session, usedPercent: 30 }, weekly])
  })

  it('keeps known percentages and preserves new status-only windows', () => {
    expect(
      mergeUsageWindows([session], [{ ...session, status: 'warning', usedPercent: null }]),
    ).toEqual([{ ...session, status: 'warning' }])
    expect(mergeUsageWindows([], [{ ...weekly, usedPercent: null }])).toEqual([
      { ...weekly, usedPercent: null },
    ])
  })

  it('returns the previous array itself when nothing changed', () => {
    const previous = [session, weekly]

    expect(mergeUsageWindows(previous, [{ ...session, resetsAt: null }])).toBe(previous)
  })

  it('keeps the percentage age for a newer status-only observation in the same epoch', () => {
    const observedAt = '2026-09-24T10:00:00.000Z'
    const known = { ...session, observedAt, source: 'codex-account-rate-limits' }
    expect(
      mergeObservedUsageWindows(
        [known],
        [
          {
            ...session,
            status: 'warning',
            usedPercent: null,
            observedAt: '2026-09-24T10:10:00.000Z',
            source: 'cliproxy-passive-cache',
          },
        ],
      ),
    ).toMatchObject([{ usedPercent: 20, observedAt, source: known.source, status: 'warning' }])
  })

  it('clears an earlier epoch percentage when a newer status-only observation changes reset', () => {
    const observedAt = '2026-09-24T10:10:00.000Z'
    expect(
      mergeObservedUsageWindows(
        [{ ...session, observedAt: '2026-09-24T10:00:00.000Z' }],
        [
          {
            ...session,
            usedPercent: null,
            status: 'rejected',
            resetsAt: '2026-09-24T11:00:00.000Z',
            observedAt,
          },
        ],
      ),
    ).toMatchObject([{ usedPercent: null, observedAt, resetsAt: '2026-09-24T11:00:00.000Z' }])
  })

  it('uses a native observation over a copied proxy snapshot at the same instant in either order', () => {
    const native = {
      ...session,
      observedAt: '2026-09-24T10:00:00.000Z',
      source: 'codex-account-rate-limits',
    }
    const proxy = { ...native, usedPercent: 90, source: 'cliproxy-passive-cache' }
    expect(mergeObservedUsageWindows([native], [proxy])).toMatchObject([native])
    expect(mergeObservedUsageWindows([proxy], [native])).toMatchObject([native])
  })

  it('keeps an authoritative native rejection over copied numeric data at the same instant', () => {
    const native: ProviderUsageWindow = {
      ...session,
      usedPercent: null,
      status: 'rejected',
      observedAt: '2026-09-24T10:00:00.000Z',
      source: 'rate-limit-event',
    }
    const proxy = { ...session, observedAt: native.observedAt, source: 'cliproxy-passive-cache' }
    const forward = mergeObservedUsageWindows([native], [proxy])
    expect(forward).toEqual(mergeObservedUsageWindows([proxy], [native]))
    expect(forward).toMatchObject([
      {
        usedPercent: 20,
        status: 'rejected',
        observedAt: native.observedAt,
        statusSource: native.source,
      },
    ])
  })

  it('resolves equal-time copied cache conflicts conservatively in either arrival order', () => {
    const numeric = {
      ...session,
      source: 'cliproxy-passive-cache',
      observedAt: '2026-09-24T10:00:00.000Z',
    }
    const rejected: ProviderUsageWindow = { ...numeric, usedPercent: 100, status: 'rejected' }
    const forward = mergeObservedUsageWindows([numeric], [rejected])
    expect(forward).toEqual(mergeObservedUsageWindows([rejected], [numeric]))
    expect(forward).toMatchObject([{ usedPercent: 100, status: 'rejected' }])
  })

  it('keeps newer rejection authority while accepting an intermediate delayed numeric counter', () => {
    const numeric = {
      ...session,
      source: 'cliproxy-passive-cache',
      observedAt: '2026-09-24T10:00:00.000Z',
    }
    const statusAt = '2026-09-24T10:10:00.000Z'
    const rejected: ProviderUsageWindow = {
      ...numeric,
      usedPercent: null,
      status: 'rejected',
      observedAt: statusAt,
    }
    const latest = mergeObservedUsageWindows([numeric], [rejected])
    const delayed = { ...numeric, usedPercent: 25, observedAt: '2026-09-24T10:05:00.000Z' }
    const merged = mergeObservedUsageWindows(latest, [delayed])
    expect(merged).toMatchObject([
      {
        usedPercent: 25,
        observedAt: delayed.observedAt,
        status: 'rejected',
        statusObservedAt: statusAt,
        statusSource: numeric.source,
      },
    ])
    const recovered = { ...numeric, usedPercent: 30, observedAt: '2026-09-24T10:15:00.000Z' }
    expect(mergeObservedUsageWindows(merged, [recovered])).toMatchObject([
      {
        usedPercent: 30,
        observedAt: recovered.observedAt,
        status: 'allowed',
        statusObservedAt: recovered.observedAt,
      },
    ])
  })
})

describe('usage limit messages', () => {
  const spent = (id: string, label: string, hours: number): ProviderUsageWindow => ({
    id,
    kind: 'session',
    label,
    resetsAt: new Date(RESET_MS + hours * 3_600_000).toISOString(),
    status: 'rejected',
    usedPercent: 100,
    windowMinutes: 300,
  })

  it('names the spent window that frees last and how long until it does', () => {
    const window = stoppingUsageWindow(
      [spent('primary', 'Session', 2), spent('secondary', 'Weekly', 50)],
      RESET_MS,
    )

    expect(usageLimitMessage({ atMs: RESET_MS, provider: 'Codex', window })).toBe(
      'Codex usage limit reached. The weekly limit resets in 2d 2h.',
    )
  })

  it('says nothing about when once no spent window is known', () => {
    expect(
      usageLimitMessage({
        atMs: RESET_MS,
        provider: 'Claude',
        window: stoppingUsageWindow([spent('primary', 'Session', -1)], RESET_MS),
      }),
    ).toBe('Claude usage limit reached.')
  })
})

function getUsage(
  rateLimits: NonNullable<SDKControlGetUsageResponse['rate_limits']>,
): SDKControlGetUsageResponse {
  return {
    behaviors: null,
    rate_limits: rateLimits,
    rate_limits_available: true,
    session: {
      model_usage: {},
      total_api_duration_ms: 0,
      total_cost_usd: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    },
    subscription_type: 'max',
  }
}
