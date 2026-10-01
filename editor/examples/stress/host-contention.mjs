import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'

/*
 * An ESTIMATE of CPU time on the runner's pinned CPUs that its own process tree did not account
 * for, read at scenario-group boundaries (Linux only). Its assumptions, recorded with each reading
 * where they can be observed:
 * - /proc/stat busy time includes interrupt, softirq and steal time, kept separate here;
 * - own-tree CPU counts every CPU a process ran on, so it matches the pinned set only while every
 *   descendant is confined to it (`ownTreeConfined`, checked at the end read);
 * - /proc is read process by process, so a child exiting or being reaped between reads can be
 *   missed or counted twice; the residual is therefore signed and never clamped;
 * - counters move in USER_HZ ticks (`userHz`), so short groups carry tick-sized error.
 * A residual is correlation evidence about other work on the measurement cores. It identifies no
 * process and is not an admission criterion.
 */

let userHz = null

function readUserHz() {
  userHz ??= Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
  return userHz
}

function expandCpuList(list) {
  return list
    .trim()
    .split(',')
    .flatMap((range) => {
      const [first, last = first] = range.split('-').map(Number)
      return Array.from({ length: last - first + 1 }, (_, index) => first + index)
    })
}

async function allowedCpus(pid) {
  const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => null)
  const match = status && /^Cpus_allowed_list:\s*(.+)$/m.exec(status)
  return match ? expandCpuList(match[1]) : null
}

async function pinnedTicks(cpus) {
  const wanted = new Set(cpus.map((cpu) => `cpu${cpu}`))
  const ticks = { task: 0, interrupt: 0, steal: 0 }
  for (const line of (await readFile('/proc/stat', 'utf8')).split('\n')) {
    const [name, ...fields] = line.trim().split(/\s+/)
    if (!wanted.has(name)) continue
    const [user, nice, system, , , irq, softirq, steal] = fields.map(Number)
    ticks.task += user + nice + system
    ticks.interrupt += irq + softirq
    ticks.steal += steal
  }
  return ticks
}

// CPU ticks of a process and its descendants, including children they already reaped.
async function ownTree(root) {
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
  const members = []
  const pending = [root]
  while (pending.length) {
    const pid = pending.pop()
    members.push(pid)
    for (const [child, info] of processes) if (info.parent === pid) pending.push(child)
  }
  const ticks = members.reduce((sum, pid) => sum + (processes.get(pid)?.ticks ?? 0), 0)
  return { ticks, members }
}

async function confined(members, cpus) {
  const pinned = new Set(cpus)
  for (const pid of members) {
    const allowed = await allowedCpus(pid)
    if (allowed && allowed.some((cpu) => !pinned.has(cpu))) return false
  }
  return true
}

async function readCounters(cpus) {
  const before = performance.now()
  const pinned = await pinnedTicks(cpus)
  const own = await ownTree(process.pid)
  return { at: before, collectionMs: performance.now() - before, pinned, own }
}

/** Starts one boundary-to-boundary estimate; the returned function ends it. */
export async function startHostCpuEstimate() {
  const hz = readUserHz()
  const cpus = await allowedCpus(process.pid)
  const startedAt = new Date().toISOString()
  const start = await readCounters(cpus)
  return async () => {
    const end = await readCounters(cpus)
    const tickMs = 1000 / hz
    const elapsedMs = end.at - start.at
    const taskMs = (end.pinned.task - start.pinned.task) * tickMs
    const interruptMs = (end.pinned.interrupt - start.pinned.interrupt) * tickMs
    const stealMs = (end.pinned.steal - start.pinned.steal) * tickMs
    const ownTreeMs = (end.own.ticks - start.own.ticks) * tickMs
    const residualMs = taskMs + interruptMs + stealMs - ownTreeMs
    return {
      startedAt,
      userHz: hz,
      pinnedCpus: cpus.join(','),
      elapsedMs,
      startCollectionMs: start.collectionMs,
      endCollectionMs: end.collectionMs,
      pinnedTaskMs: taskMs,
      pinnedInterruptMs: interruptMs,
      pinnedStealMs: stealMs,
      ownTreeMs,
      ownTreeProcesses: end.own.members.length,
      ownTreeConfined: await confined(end.own.members, cpus),
      residualMs,
      residualShare: residualMs / (cpus.length * elapsedMs),
    }
  }
}
