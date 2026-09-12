import { ORCHESTRATION_REPLAY_MAX_EVENTS } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import {
  createProjectionFixture,
  pendingEvent,
  PROJECT_ID,
  sessionBootstrapEvents,
} from './factories/projection'

const fixtures: ReturnType<typeof createProjectionFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

test('catch-up commits complete pages and retries a failed page without partial projections', () => {
  const fixture = createProjectionFixture()
  fixtures.push(fixture)
  fixture.pipeline.applyEvents(fixture.append(sessionBootstrapEvents()))
  const initialSequence = fixture.pipeline.lastAppliedSequence()
  const count = ORCHESTRATION_REPLAY_MAX_EVENTS + 105
  fixture.append(
    Array.from({ length: count }, (_, index) =>
      pendingEvent('project.meta-updated', {
        projectId: PROJECT_ID,
        title: `Title ${index}`,
        updatedAt: '2026-09-05T12:00:00.000Z',
      }),
    ),
  )
  const firstPageSequence = initialSequence + ORCHESTRATION_REPLAY_MAX_EVENTS
  fixture.database.$client.exec(`
    CREATE TRIGGER replay_page_failure BEFORE UPDATE ON projection_state
    WHEN NEW.last_applied_sequence = ${firstPageSequence + 2}
    BEGIN SELECT RAISE(ABORT, 'replay page failure'); END
  `)

  expect(() => fixture.pipeline.catchUp()).toThrow('replay page failure')
  expect(fixture.pipeline.lastAppliedSequence()).toBe(firstPageSequence)
  expect(fixture.snapshots.fullReadModel().projects.get(PROJECT_ID)?.title).toBe(
    `Title ${ORCHESTRATION_REPLAY_MAX_EVENTS - 1}`,
  )

  fixture.database.$client.exec('DROP TRIGGER replay_page_failure')
  fixture.pipeline.catchUp()
  expect(fixture.pipeline.lastAppliedSequence()).toBe(initialSequence + count)
  expect(fixture.snapshots.fullReadModel().projects.get(PROJECT_ID)?.title).toBe(
    `Title ${count - 1}`,
  )
})
