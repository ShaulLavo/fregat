import * as v from 'valibot'
import { rename, writeFile } from 'node:fs/promises'

export type Observation = { resetAt: number; usedPercent: number }
export type Provider = 'codex' | 'claude'
export type Credential = {
  name: string
  provider: Provider
  index: string
  priority: number
  disabled: boolean
  observation: Observation | null
}
export type ResetOrderOptions = {
  proxyUrl: string
  managementKeyFile: string
  stateFile: string
  intervalMs?: number
}

const signalsSchema = v.record(v.string(), v.string())
const authFilesSchema = v.object({
  files: v.array(
    v.object({
      name: v.string(),
      auth_index: v.string(),
      provider: v.string(),
      disabled: v.optional(v.boolean()),
      priority: v.optional(v.nullable(v.number())),
      quota: v.optional(v.object({ signals: v.optional(signalsSchema) })),
    }),
  ),
})
type StoredObservation = Observation & { disabledByLoop?: boolean }
const stateSchema = v.record(
  v.string(),
  v.object({
    resetAt: v.number(),
    usedPercent: v.number(),
    disabledByLoop: v.optional(v.boolean()),
  }),
)
const neutralPriority = 0
const spentPriority = -1
const giveUpAfterFailures = 10
const requestTimeoutMs = 5_000

const pooledProviders: readonly string[] = ['codex', 'claude'] satisfies Provider[]

function isPooled(provider: string): provider is Provider {
  return pooledProviders.includes(provider)
}

function readSeconds(value: string | undefined) {
  if (value === undefined || value.trim() === '') return Number.NaN
  const seconds = Number(value)
  return Number.isNaN(seconds) ? Date.parse(value) / 1_000 : seconds
}

// Codex reports its weekly window as a percentage; Claude as a 0–1 utilization plus a status
// that reads `rejected` once the window is spent.
export function readObservation(
  provider: Provider,
  signals: Readonly<Record<string, string>> | undefined,
): Observation | null {
  if (provider === 'codex') {
    const primaryWindow = signals?.['X-Codex-Primary-Window-Minutes']
    const secondaryWindow = signals?.['X-Codex-Secondary-Window-Minutes']
    const window = secondaryWindow === '10080' ? 'Secondary' : 'Primary'
    if (window === 'Primary' && primaryWindow !== undefined && primaryWindow !== '10080')
      return null
    const resetAt = Number(signals?.[`X-Codex-${window}-Reset-At`] ?? Number.NaN)
    const usedPercent = Number(signals?.[`X-Codex-${window}-Used-Percent`] ?? Number.NaN)
    if (!Number.isFinite(resetAt) || !Number.isFinite(usedPercent)) return null
    return { resetAt, usedPercent }
  }
  const resetAt = readSeconds(signals?.['Anthropic-Ratelimit-Unified-7d-Reset'])
  const utilization = Number(signals?.['Anthropic-Ratelimit-Unified-7d-Utilization'] ?? Number.NaN)
  if (!Number.isFinite(resetAt) || !Number.isFinite(utilization)) return null
  const rejected = signals?.['Anthropic-Ratelimit-Unified-7d-Status']?.toLowerCase() === 'rejected'
  return { resetAt, usedPercent: rejected ? 100 : Math.min(100, utilization * 100) }
}

// Proxy quota observations live in memory only, so the last one per account survives restarts here.
export function mergeObservations(
  credentials: readonly Credential[],
  stored: Readonly<Record<string, Observation>>,
  nowSeconds: number,
) {
  const merged: Record<string, Observation> = {}
  for (const credential of credentials) {
    const observation = credential.observation ?? stored[credential.index]
    if (!observation || observation.resetAt <= nowSeconds) continue
    merged[credential.index] = {
      resetAt: observation.resetAt,
      usedPercent: observation.usedPercent,
    }
  }
  return merged
}

// Soonest weekly reset first among accounts with quota left; unknown accounts sit at the default
// priority, and spent ones below it so a lapsed cooldown cannot put them ahead of usable quota.
// Each provider ranks separately: a Claude account never competes with a Codex one for a model.
export function planPriorities(
  credentials: readonly Credential[],
  observations: Readonly<Record<string, Observation>>,
) {
  const priorities = new Map<string, number>()
  for (const provider of pooledProviders) {
    const group = credentials.filter((credential) => credential.provider === provider)
    for (const [name, priority] of planGroup(group, observations)) priorities.set(name, priority)
  }
  return priorities
}

function planGroup(
  credentials: readonly Credential[],
  observations: Readonly<Record<string, Observation>>,
) {
  const ranked = credentials
    .filter((credential) => (observations[credential.index]?.usedPercent ?? 100) < 100)
    .toSorted(
      (a, b) =>
        observations[a.index]!.resetAt - observations[b.index]!.resetAt ||
        a.index.localeCompare(b.index),
    )
  const priorities = new Map<string, number>()
  for (const credential of credentials) {
    priorities.set(
      credential.name,
      observations[credential.index] ? spentPriority : neutralPriority,
    )
  }
  for (const [rank, credential] of ranked.entries()) {
    priorities.set(credential.name, ranked.length - rank)
  }
  return priorities
}

// Disabling a spent Codex account breaks affinity before paid credits become the next request's fuel.
export function planDisabled(
  credentials: readonly Credential[],
  observations: Readonly<Record<string, Observation>>,
  owned: ReadonlySet<string>,
) {
  const codex = credentials.filter((credential) => credential.provider === 'codex')
  const weeklyAvailable = codex.some(
    (credential) =>
      (!credential.disabled || owned.has(credential.index)) &&
      (observations[credential.index]?.usedPercent ?? 100) < 100,
  )
  const allSpent = codex.every((credential) => {
    if (credential.disabled && !owned.has(credential.index)) return true
    return (observations[credential.index]?.usedPercent ?? 0) >= 100
  })
  const changes = new Map<string, boolean>()
  for (const credential of codex) {
    if (credential.disabled && !owned.has(credential.index)) continue
    const spent = (observations[credential.index]?.usedPercent ?? 0) >= 100
    const keepDisabled = credential.disabled && !allSpent
    const disabled = spent && (weeklyAvailable || keepDisabled)
    if (disabled !== credential.disabled) changes.set(credential.index, disabled)
  }
  return changes
}

function report(level: 'warn' | 'info', state: string, fields: Record<string, unknown>) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      source: 'be',
      area: 'claude-gpt',
      operation: 'reset-order',
      state,
      ...fields,
    })}\n`,
  )
}

async function readState(stateFile: string) {
  try {
    return v.parse(stateSchema, await Bun.file(stateFile).json())
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return {}
    throw error
  }
}

async function writeState(stateFile: string, state: Readonly<Record<string, StoredObservation>>) {
  const temporary = `${stateFile}.tmp`
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  await rename(temporary, stateFile)
}

async function management(options: ResetOrderOptions, path: string, init: RequestInit = {}) {
  const managementKey = (await Bun.file(options.managementKeyFile).text()).trim()
  const response = await fetch(new URL(`/v0/management/${path}`, options.proxyUrl), {
    ...init,
    headers: { authorization: `Bearer ${managementKey}`, 'content-type': 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    return { ok: false as const, status: response.status }
  }
  return { ok: true as const, body: (await response.json()) as unknown }
}

async function readCredentials(options: ResetOrderOptions) {
  const listed = await management(options, 'auth-files')
  if (!listed.ok) return { ok: false as const, status: listed.status }
  const parsed = v.safeParse(authFilesSchema, listed.body)
  if (!parsed.success) return { ok: false as const, status: 'invalid-body' }
  const credentials: Credential[] = []
  for (const file of parsed.output.files) {
    if (!isPooled(file.provider)) continue
    credentials.push({
      name: file.name,
      provider: file.provider,
      index: file.auth_index,
      priority: file.priority ?? neutralPriority,
      disabled: file.disabled ?? false,
      observation: readObservation(file.provider, file.quota?.signals),
    })
  }
  return { ok: true as const, credentials }
}

async function applyOrder(options: ResetOrderOptions) {
  const listed = await readCredentials(options)
  if (!listed.ok) return { ok: false as const, status: listed.status }
  const stored = await readState(options.stateFile)
  const credentials = listed.credentials.filter(
    (credential) => !credential.disabled || stored[credential.index]?.disabledByLoop,
  )
  const owned = new Set(
    credentials.filter((credential) => credential.disabled).map((credential) => credential.index),
  )
  const observations = mergeObservations(credentials, stored, Date.now() / 1_000)
  const state: Record<string, StoredObservation> = { ...observations }
  for (const index of owned) {
    state[index] = { ...(observations[index] ?? stored[index]!), disabledByLoop: true }
  }
  if (JSON.stringify(state) !== JSON.stringify(stored)) await writeState(options.stateFile, state)
  const disabled = planDisabled(credentials, observations, owned)
  for (const credential of credentials) {
    const next = disabled.get(credential.index)
    if (next === undefined) continue
    if (next) {
      // The proxy can apply a change before its response is lost; record the intent first.
      state[credential.index] = { ...observations[credential.index]!, disabledByLoop: true }
      await writeState(options.stateFile, state)
    }
    const patched = await management(options, 'auth-files/status', {
      method: 'PATCH',
      body: JSON.stringify({ name: credential.name, auth_index: credential.index, disabled: next }),
    })
    if (!patched.ok) return { ok: false as const, status: patched.status }
    credential.disabled = next
    if (next) continue
    if (observations[credential.index]) state[credential.index] = observations[credential.index]!
    else delete state[credential.index]
    await writeState(options.stateFile, state)
  }
  if (disabled.size > 0) {
    report('info', 'availability-changed', {
      disabled: [...disabled.values()].filter(Boolean).length,
      enabled: [...disabled.values()].filter((value) => !value).length,
    })
  }
  const enabled = credentials.filter((credential) => !credential.disabled)
  const priorities = planPriorities(enabled, observations)
  const changed = enabled.filter(
    (credential) => priorities.get(credential.name) !== credential.priority,
  )
  for (const credential of changed) {
    const patched = await management(options, 'auth-files/fields', {
      method: 'PATCH',
      body: JSON.stringify({ name: credential.name, priority: priorities.get(credential.name) }),
    })
    if (!patched.ok) return { ok: false as const, status: patched.status }
  }
  if (changed.length > 0) {
    report('info', 'reordered', {
      changed: changed.length,
      order: enabled
        .toSorted((a, b) => priorities.get(b.name)! - priorities.get(a.name)!)
        .map((credential) => ({
          provider: credential.provider,
          authIndex: credential.index,
          priority: priorities.get(credential.name),
        })),
    })
  }
  return { ok: true as const }
}

export function startResetOrder(options: ResetOrderOptions) {
  const intervalMs = options.intervalMs ?? 60_000
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function tick() {
    const result = await applyOrder(options).catch((error: unknown) => ({
      ok: false as const,
      status: error instanceof Error ? error.name : typeof error,
    }))
    if (stopped) return
    if (result.ok) {
      if (failures > 0) report('info', 'recovered', { count: failures })
      failures = 0
    } else {
      failures++
      if (failures === 1) {
        report('warn', 'failing', {
          status: result.status,
          why: 'The proxy routing check could not read its state or apply credential changes.',
          fix: 'Check proxy management access and that the routing state file is readable and valid.',
        })
      }
      if (failures >= giveUpAfterFailures) {
        report('warn', 'gave-up', { count: failures, status: result.status })
        return
      }
    }
    timer = setTimeout(tick, intervalMs)
  }

  // The proxy needs a moment to bind and load credentials after spawn.
  timer = setTimeout(tick, Math.min(intervalMs, 5_000))
  return {
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
