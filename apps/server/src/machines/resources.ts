import { cpus, freemem, totalmem } from 'node:os'
import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import { defineErrorCatalog } from 'evlog'
import type { HostResources } from '@workspace/contracts'
import { createStructuredError } from '../observability/structured-errors'

const errors = defineErrorCatalog('machines', {
  RESOURCES_UNAVAILABLE: {
    status: 503,
    message: 'Machine capacity could not be read.',
    why: 'The operating system did not provide its available memory.',
    fix: 'Choose a machine in the session workspace controls.',
  },
})

/** Sample twice so a machine's lifetime average cannot hide its current load. */
export async function readHostResources(readCpus: typeof cpus = cpus): Promise<HostResources> {
  const before = readCpus()
  // Bun materializes OS counters lazily; read them before the sampling wait.
  const first = cpuTimes(before)
  await setTimeout(200)
  const after = readCpus()
  const last = cpuTimes(after)
  const elapsed = last.total - first.total
  const idle = last.idle - first.idle
  const totalMemoryBytes = totalmem()
  const availableMemoryBytes = await readAvailableMemory()
  return {
    sampledAt: Date.now(),
    cpuCount: after.length,
    cpuUtilization:
      before.length === after.length && elapsed > 0 && idle >= 0
        ? Math.max(0, Math.min(1, 1 - idle / elapsed))
        : null,
    totalMemoryBytes,
    availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
  }
}

async function readAvailableMemory() {
  if (process.platform !== 'linux') return freemem()
  const meminfo = await readFile('/proc/meminfo', 'utf8').catch((cause: unknown) => {
    throw createStructuredError({
      ...errors.RESOURCES_UNAVAILABLE(),
      cause,
      internal: { platform: process.platform, operation: 'read_available_memory' },
    })
  })
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1]
  if (available) return Number(available) * 1024
  throw createStructuredError({
    ...errors.RESOURCES_UNAVAILABLE(),
    internal: {
      platform: process.platform,
      operation: 'parse_available_memory',
      field: 'MemAvailable',
    },
  })
}

function cpuTimes(samples: ReturnType<typeof cpus>) {
  return samples.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  )
}
