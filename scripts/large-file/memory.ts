import { readFileSync, readdirSync } from 'node:fs'

function processInfo(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    return {
      pid,
      parent: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]),
      bytes: Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) * 1024,
      command: readFileSync(`/proc/${pid}/cmdline`, 'utf8'),
    }
  } catch {
    return null
  }
}

function processTree(root: number) {
  if (process.platform !== 'linux') return []
  const all = readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .map(processInfo)
  const known = new Set([root])
  let previous = 0
  while (known.size !== previous) {
    previous = known.size
    for (const child of all) {
      if (child && known.has(child.parent)) known.add(child.pid)
    }
  }
  return all
    .filter((child) => child !== null)
    .filter((child) => known.has(child.pid) && child.pid !== root)
}

export function sampleMemory(root: number) {
  let peaks = { browserBytes: 0, rendererBytes: 0, serverTreeBytes: 0, totalBytes: 0 }
  const sample = () => {
    const current = { browserBytes: 0, rendererBytes: 0, serverTreeBytes: 0, totalBytes: 0 }
    for (const child of processTree(root)) {
      current.totalBytes += child.bytes
      if (/chrom|headless/.test(child.command)) current.browserBytes += child.bytes
      else current.serverTreeBytes += child.bytes
      if (child.command.includes('--type=renderer')) current.rendererBytes += child.bytes
    }
    for (const key of Object.keys(current) as (keyof typeof current)[])
      peaks[key] = Math.max(peaks[key], current[key])
  }
  const timer = setInterval(sample, 50)
  return {
    read() {
      sample()
      return process.platform === 'linux' ? { ...peaks } : null
    },
    reset() {
      peaks = { browserBytes: 0, rendererBytes: 0, serverTreeBytes: 0, totalBytes: 0 }
      sample()
    },
    stop() {
      clearInterval(timer)
    },
  }
}
