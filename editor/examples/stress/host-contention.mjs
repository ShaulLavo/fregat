import { readdir, readFile } from 'node:fs/promises'

// Linux reports both /proc/stat and per-process CPU time in USER_HZ ticks of 10 ms.
const tickMs = 10

function expandCpuList(list) {
  return list
    .trim()
    .split(',')
    .flatMap((range) => {
      const [first, last = first] = range.split('-').map(Number)
      return Array.from({ length: last - first + 1 }, (_, index) => first + index)
    })
}

async function pinnedCpus() {
  const status = await readFile('/proc/self/status', 'utf8')
  return expandCpuList(/^Cpus_allowed_list:\s*(.+)$/m.exec(status)[1])
}

// Busy ticks of the given CPUs: everything except idle and iowait.
async function cpuBusyTicks(cpus) {
  const wanted = new Set(cpus.map((cpu) => `cpu${cpu}`))
  let busy = 0
  for (const line of (await readFile('/proc/stat', 'utf8')).split('\n')) {
    const [name, ...fields] = line.trim().split(/\s+/)
    if (!wanted.has(name)) continue
    const [user, nice, system, , , irq, softirq, steal] = fields.map(Number)
    busy += user + nice + system + irq + softirq + steal
  }
  return busy
}

// CPU ticks of a process and every descendant, including children they already reaped.
async function treeTicks(root) {
  const processes = new Map()
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const stat = await readFile(`/proc/${entry}/stat`, 'utf8').catch(() => null)
    if (!stat) continue
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const [utime, stime, cutime, cstime] = fields.slice(11, 15).map(Number)
    processes.set(Number(entry), {
      parent: Number(fields[1]),
      ticks: utime + stime + cutime + cstime,
    })
  }
  let ticks = 0
  const pending = [root]
  while (pending.length) {
    const pid = pending.pop()
    ticks += processes.get(pid)?.ticks ?? 0
    for (const [child, info] of processes) if (info.parent === pid) pending.push(child)
  }
  return ticks
}

/**
 * Starts a contention reading for one scenario group. CPU time on the runner's pinned CPUs that its
 * own process tree did not use belongs to other work sharing the measurement cores.
 */
export async function startContention() {
  const cpus = await pinnedCpus()
  const startedAt = Date.now()
  const busy = await cpuBusyTicks(cpus)
  const own = await treeTicks(process.pid)
  return async () => {
    const endedAt = Date.now()
    const busyMs = ((await cpuBusyTicks(cpus)) - busy) * tickMs
    const ownMs = ((await treeTicks(process.pid)) - own) * tickMs
    return {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      pinnedCpus: cpus.join(','),
      pinnedBusyMs: busyMs,
      ownCpuMs: ownMs,
      foreignMs: Math.max(0, busyMs - ownMs),
      foreignShare: Math.max(0, busyMs - ownMs) / (cpus.length * Math.max(1, endedAt - startedAt)),
    }
  }
}
