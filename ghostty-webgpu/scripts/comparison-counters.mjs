import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { join } from 'node:path'

const macFields = {
  identity: 'ri_proc_start_abstime',
  exit: 'ri_proc_exit_abstime',
  userTimeNs: 'ri_user_time',
  systemTimeNs: 'ri_system_time',
  pUserTimeNs: 'ri_user_ptime',
  pSystemTimeNs: 'ri_system_ptime',
  instructions: 'ri_instructions',
  cycles: 'ri_cycles',
  pInstructions: 'ri_pinstructions',
  pCycles: 'ri_pcycles',
  energyNj: 'ri_energy_nj',
  pEnergyNj: 'ri_penergy_nj',
}

function integer(value, name) {
  assert(
    typeof value === 'string' && /^\d+$/.test(value),
    `${name} requires an unsigned decimal integer string`,
  )
  return BigInt(value)
}

function parsePerf(values) {
  const pmus = {}
  for (const [pmu, events] of Object.entries(values.pmus)) {
    pmus[pmu] = {}
    for (const name of ['instructions', 'cycles']) {
      assert(
        Array.isArray(events[name]) && events[name].length,
        `${pmu}/${name} requires thread counters`,
      )
      pmus[pmu][name] = events[name].map((entry) => ({
        tid: entry.tid,
        value: integer(entry.value, name),
        enabledNs: integer(entry.enabledNs, 'enabledNs'),
        runningNs: integer(entry.runningNs, 'runningNs'),
      }))
    }
  }
  assert(Object.keys(pmus).length, 'At least one PMU required')
  return {
    identity: integer(values.identity, 'identity'),
    userTimeNs: integer(values.userTimeNs, 'userTimeNs'),
    systemTimeNs: integer(values.systemTimeNs, 'systemTimeNs'),
    pmus,
  }
}

export function parseCounterSnapshot(raw, metadata) {
  assert(
    ['proc_pid_rusage/RUSAGE_INFO_V6', 'perf_event_open'].includes(metadata.source),
    'Known counter source required',
  )
  const requestedNs = integer(raw.requestedNs, 'requestedNs')
  const completedNs = integer(raw.completedNs, 'completedNs')
  assert(completedNs >= requestedNs, 'Ordered snapshot acquisition timestamps required')
  const processes = new Map()
  for (const [pid, entry] of Object.entries(raw.processes)) {
    assert(Number.isSafeInteger(Number(pid)) && Number(pid) > 0, 'Positive integer PID required')
    const { values } = entry
    const times = {
      requestedNs: integer(entry.requestedNs, 'requestedNs'),
      completedNs: integer(entry.completedNs, 'completedNs'),
    }
    assert(
      times.completedNs >= times.requestedNs,
      'Ordered process acquisition timestamps required',
    )
    assert(
      times.requestedNs >= requestedNs && times.completedNs <= completedNs,
      'Snapshot timestamps must enclose each process read',
    )
    if (values.error !== undefined) {
      processes.set(Number(pid), { ...times, error: values.reason ?? String(values.error) })
      continue
    }
    const counters =
      metadata.source === 'perf_event_open'
        ? parsePerf(values)
        : Object.fromEntries(
            Object.entries(macFields).map(([name, field]) => [name, integer(values[field], field)]),
          )
    processes.set(Number(pid), { ...times, ...counters })
  }
  return {
    requestedNs,
    completedNs,
    processes,
    metadata,
  }
}

function difference(before, after, name) {
  const amount = after - before
  assert(
    amount >= 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER),
    `${name} delta regressed or exceeds exact numeric range`,
  )
  return Number(amount)
}

function addCount(left, right, name) {
  const value = left + right
  assert(Number.isSafeInteger(value), `${name} aggregate exceeds exact numeric range`)
  return value
}

function perfDelta(before, after) {
  assert.deepEqual(Object.keys(before.pmus), Object.keys(after.pmus), 'PMU set changed')
  const pmus = {}
  for (const [pmu, events] of Object.entries(after.pmus)) {
    const result = {}
    for (const name of ['instructions', 'cycles']) {
      const previous = before.pmus[pmu][name]
      assert.deepEqual(
        previous.map((row) => row.tid),
        events[name].map((row) => row.tid),
        'Attached thread counter set changed',
      )
      result[name] = 0
      result[`${name}Coverage`] = events[name].map((entry, index) => {
        const old = previous[index]
        const value = difference(old.value, entry.value, name)
        const enabledNs = difference(old.enabledNs, entry.enabledNs, 'enabledNs')
        const runningNs = difference(old.runningNs, entry.runningNs, 'runningNs')
        assert(value === 0 || runningNs > 0, 'Nonzero perf count requires running time')
        result[name] = addCount(result[name], value, name)
        return { tid: entry.tid, enabledNs, runningNs }
      })
    }
    pmus[pmu] = result
  }
  return {
    instructions: Object.values(pmus).reduce(
      (sum, row) => addCount(sum, row.instructions, 'instructions'),
      0,
    ),
    cycles: Object.values(pmus).reduce((sum, row) => addCount(sum, row.cycles, 'cycles'), 0),
    pmus,
  }
}

function processDelta(before, after, metadata) {
  assert(before.identity === after.identity, 'PID start identity changed')
  assert(!after.exit, 'Process exited during the window')
  const userSeconds = difference(before.userTimeNs, after.userTimeNs, 'userTimeNs') / 1e9
  const systemSeconds = difference(before.systemTimeNs, after.systemTimeNs, 'systemTimeNs') / 1e9
  const linux = metadata.source === 'perf_event_open'
  const result = {
    cpuSeconds: linux ? userSeconds : userSeconds + systemSeconds,
    userSeconds,
    systemSeconds,
  }
  if (linux) return { ...result, ...perfDelta(before, after) }
  for (const field of [
    'instructions',
    'cycles',
    'pInstructions',
    'pCycles',
    'energyNj',
    'pEnergyNj',
  ])
    result[field] = difference(before[field], after[field], field)
  result.pCoreSeconds =
    (difference(before.pUserTimeNs, after.pUserTimeNs, 'pUserTimeNs') +
      difference(before.pSystemTimeNs, after.pSystemTimeNs, 'pSystemTimeNs')) /
    1e9
  assert(result.pCoreSeconds <= result.cpuSeconds + 1e-9, 'P-core time exceeds total CPU time')
  return result
}

function channel(rows, mac) {
  const sum = (field) =>
    rows.reduce((total, row) => {
      const value = row[field] ?? 0
      return field.endsWith('Seconds') ? total + value : addCount(total, value, field)
    }, 0)
  const cpuSeconds = sum('cpuSeconds')
  const cycles = sum('cycles')
  const pCoreSeconds = mac ? sum('pCoreSeconds') : null
  return {
    instructions: sum('instructions'),
    cycles,
    cpuSeconds,
    pCoreSeconds,
    pInstructions: mac ? sum('pInstructions') : null,
    pCycles: mac ? sum('pCycles') : null,
    pCoreShare: mac && cpuSeconds > 0 ? pCoreSeconds / cpuSeconds : null,
    effectiveClockGHz: cpuSeconds > 0 ? cycles / cpuSeconds / 1e9 : null,
    effectivePClockGHz: pCoreSeconds > 0 ? sum('pCycles') / pCoreSeconds / 1e9 : null,
    energyJ: mac ? sum('energyNj') / 1e9 : null,
    pEnergyJ: mac ? sum('pEnergyNj') / 1e9 : null,
  }
}

export function counterDelta(before, after, cpuBefore, cpuAfter) {
  const prior = new Map(cpuBefore.map((row) => [row.id, row.type]))
  const final = new Map(cpuAfter.map((row) => [row.id, row.type]))
  const coverage = { matched: [], errors: [] }
  const processes = []
  for (const pid of new Set([...prior.keys(), ...final.keys()])) {
    const first = before.processes.get(pid)
    const last = after.processes.get(pid)
    try {
      assert(prior.has(pid) && final.has(pid), 'CDP process appeared or disappeared')
      assert(prior.get(pid) === final.get(pid), 'CDP process type changed')
      assert(first && last, 'Native process snapshot missing')
      assert(!first.error && !last.error, first?.error ?? last?.error ?? 'Native read failed')
      const values = processDelta(first, last, before.metadata)
      processes.push({ pid, type: final.get(pid), identity: String(last.identity), ...values })
      coverage.matched.push(pid)
    } catch (error) {
      coverage.errors.push({ pid, reason: error.message })
    }
  }
  const mac = before.metadata.source === 'proc_pid_rusage/RUSAGE_INFO_V6'
  const channels = {}
  if (!coverage.errors.length && processes.length) {
    channels.renderer = channel(
      processes.filter((row) => row.type === 'renderer'),
      mac,
    )
    channels.GPU = channel(
      processes.filter((row) => row.type === 'GPU'),
      mac,
    )
    channels.rendererPlusGPU = channel(
      processes.filter((row) => ['renderer', 'GPU'].includes(row.type)),
      mac,
    )
    channels.otherChrome = channel(
      processes.filter((row) => !['renderer', 'GPU'].includes(row.type)),
      mac,
    )
    channels.allChrome = channel(processes, mac)
  }
  return {
    status: coverage.errors.length || !processes.length ? 'incomplete' : 'measured',
    source: before.metadata.source,
    scope: mac ? 'user and system CPU; all core classes' : 'user-space only',
    cpuTickNs: before.metadata.cpuTickNs ?? null,
    limitations: mac
      ? [
          'Kernel CPU energy estimate excludes GPU-device, display and non-Chrome power.',
          'Effective clock is a counter ratio.',
          'Endpoint snapshots cannot detect processes born and gone between endpoints.',
        ]
      : [
          'Hardware counts are raw and unscaled. PMU coverage records core residency and multiplexing together.',
          'Effective clock uses tick-quantized /proc user CPU time.',
          'P-core time and per-process energy are unavailable.',
          'Endpoint snapshots cannot detect processes born and gone between endpoints.',
        ],
    processes,
    coverage,
    channels,
  }
}

export async function createCounterReader(
  session,
  { platform = process.platform, timeoutMilliseconds = 10000 } = {},
) {
  if (!['darwin', 'linux'].includes(platform))
    return { skipped: true, reason: `Native process counters are unavailable on ${platform}` }
  const executable = platform === 'darwin' ? '/usr/bin/python3' : 'python3'
  const script = platform === 'darwin' ? 'comparison-rusage.py' : 'comparison-perf.py'
  const child = spawn(executable, [join(import.meta.dirname, script)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let stderr = ''
  let failure
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-2000)
  })
  child.on('error', (error) => {
    failure = error
  })
  child.stdin.on('error', (error) => {
    failure = error
  })
  async function reply() {
    let timer
    try {
      const line = await Promise.race([
        lines.next(),
        new Promise((resolve) => {
          timer = setTimeout(
            () => resolve({ done: true, reason: 'Process counter reader timed out' }),
            timeoutMilliseconds,
          )
        }),
      ])
      assert(
        !line.done && !failure,
        line.reason ?? failure?.message ?? (stderr || 'Process counter reader exited'),
      )
      return JSON.parse(line.value)
    } finally {
      clearTimeout(timer)
    }
  }
  async function request(value) {
    child.stdin.write(`${JSON.stringify(value)}\n`)
    return reply()
  }
  async function close() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.stdin.end()
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMilliseconds)
    try {
      await exited
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    const metadata = await reply()
    assert(metadata.ready, metadata.reason ?? 'Native reader unavailable')
    if (platform === 'linux') {
      const { processInfo } = await session.send('SystemInfo.getProcessInfo')
      const attached = await request({ command: 'start', pids: processInfo.map((row) => row.id) })
      metadata.attached = attached
    }
    return {
      metadata,
      snapshot: (processes) => request({ pids: processes.map((row) => row.id) }),
      close,
    }
  } catch (error) {
    await close()
    return { skipped: true, reason: error.message }
  }
}
