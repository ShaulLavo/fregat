import * as v from 'valibot'
import { rename, writeFile } from 'node:fs/promises'

export type Observation = { resetAt: number; usedPercent: number }
export type Credential = {
  name: string
  index: string
  priority: number
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
const observationSchema = v.object({ resetAt: v.number(), usedPercent: v.number() })
const stateSchema = v.record(v.string(), observationSchema)
const neutralPriority = 0
const spentPriority = -1
const giveUpAfterFailures = 10
const requestTimeoutMs = 5_000

export function readObservation(signals: Readonly<Record<string, string>> | undefined) {
  const resetAt = Number(signals?.['X-Codex-Primary-Reset-At'] ?? Number.NaN)
  const usedPercent = Number(signals?.['X-Codex-Primary-Used-Percent'] ?? Number.NaN)
  if (!Number.isFinite(resetAt) || !Number.isFinite(usedPercent)) return null
  return { resetAt, usedPercent }
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
    merged[credential.index] = observation
  }
  return merged
}

// Soonest weekly reset first among accounts with quota left; unknown accounts sit at the default
// priority, and spent ones below it so a lapsed cooldown cannot put them ahead of usable quota.
export function planPriorities(
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
    const parsed = v.safeParse(stateSchema, await Bun.file(stateFile).json())
    return parsed.success ? parsed.output : {}
  } catch {
    return {}
  }
}

async function writeState(stateFile: string, state: Readonly<Record<string, Observation>>) {
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
  const credentials: Credential[] = parsed.output.files
    .filter((file) => file.provider === 'codex' && !file.disabled)
    .map((file) => ({
      name: file.name,
      index: file.auth_index,
      priority: file.priority ?? neutralPriority,
      observation: readObservation(file.quota?.signals),
    }))
  return { ok: true as const, credentials }
}

async function applyOrder(options: ResetOrderOptions) {
  const listed = await readCredentials(options)
  if (!listed.ok) return { ok: false as const, status: listed.status }
  const stored = await readState(options.stateFile)
  const observations = mergeObservations(listed.credentials, stored, Date.now() / 1_000)
  if (JSON.stringify(observations) !== JSON.stringify(stored)) {
    await writeState(options.stateFile, observations)
  }
  const priorities = planPriorities(listed.credentials, observations)
  const changed = listed.credentials.filter(
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
      order: listed.credentials
        .toSorted((a, b) => priorities.get(b.name)! - priorities.get(a.name)!)
        .map((credential) => ({
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
          why: 'The proxy management API did not return or accept credential priorities.',
          fix: 'Check that the proxy runs with management enabled and the management key file matches.',
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
