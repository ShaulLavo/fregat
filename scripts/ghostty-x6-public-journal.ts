import assert from 'node:assert/strict'
import type { RunnerJob } from './ghostty-x6-public-overlap.ts'

function validate(job: RunnerJob): void {
  assert(job && typeof job === 'object' && !Array.isArray(job))
  assert(typeof job.id === 'string' && job.id.length > 0)
  assert(typeof job.startedAt === 'string' && Number.isFinite(Date.parse(job.startedAt)))
  assert(job.endedAt === null || typeof job.endedAt === 'string')
  if (job.endedAt === null) return
  assert(
    Date.parse(job.endedAt) > Date.parse(job.startedAt),
    'Resolved positive runner interval required',
  )
}

function compatible(earlier: RunnerJob, later: RunnerJob): void {
  const { endedAt: firstEnd, ...firstIdentity } = earlier
  const { endedAt: lastEnd, ...lastIdentity } = later
  assert.deepEqual(lastIdentity, firstIdentity, 'Known runner job identity must survive completion')
  if (firstEnd !== null)
    assert.equal(lastEnd, firstEnd, 'Known runner finish must survive completion')
}

export function verifyX6Journal(
  completed: readonly RunnerJob[],
  snapshots: readonly Readonly<Record<string, RunnerJob>>[],
): void {
  assert(Array.isArray(completed), 'Complete actual overlap journal required')
  const final = new Map<string, RunnerJob>()
  for (const job of completed) {
    validate(job)
    assert(!final.has(job.id), 'Unique completed runner job identities required')
    final.set(job.id, job)
  }
  const known = new Map<string, RunnerJob>()
  for (const snapshot of snapshots) {
    assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot))
    for (const [id, job] of Object.entries(snapshot)) {
      validate(job)
      assert.equal(id, job.id, 'Snapshot key must identify its runner job')
      const previous = known.get(id)
      if (previous) compatible(previous, job)
      const retained = final.get(id)
      assert(retained, 'Completed journal must retain every snapshot-known runner job')
      compatible(job, retained)
      known.set(id, job)
    }
  }
}
