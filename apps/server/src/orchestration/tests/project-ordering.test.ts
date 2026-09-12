import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  orderKeyBetween,
  projectIdSchema,
  commandIdSchema,
  clientOrchestrationCommandSchema,
  orchestrationCommandSchema,
} from '@workspace/contracts'
import * as schema from '../../db/schema'
import { projectionProjects } from '../../db/schema'
import { ProjectionShellRowReader } from '../shell-row-reader'

import { createDomainEngine, projectRegistrationCommand } from './factories/engine'

let commandCounter = 0

describe('project reorder', () => {
  it('persists the key and carries it on the shell snapshot', async () => {
    const { database, engine } = await createEngineWithProjects([
      '12c7943d-799e-4c27-b6f3-4f5c57f01875',
    ])

    await engine.dispatch(reorderCommand('12c7943d-799e-4c27-b6f3-4f5c57f01875', 'm'))

    expect(projectRow(database, '12c7943d-799e-4c27-b6f3-4f5c57f01875').orderKey).toBe('m')
    expect((await engine.shellSnapshot()).projects).toEqual([
      expect.objectContaining({ orderKey: 'm' }),
    ])
  })

  it('carries the key on the shell stream delta, not only on the snapshot', async () => {
    const { database, engine } = await createEngineWithProjects([
      '12c7943d-799e-4c27-b6f3-4f5c57f01875',
    ])

    await engine.dispatch(reorderCommand('12c7943d-799e-4c27-b6f3-4f5c57f01875', 'm'))

    // The delta path reads one row per changed aggregate instead of the whole
    // snapshot, so it is the one that silently drops a newly added field.
    expect(
      new ProjectionShellRowReader(database).projectShell(
        v.parse(projectIdSchema, '12c7943d-799e-4c27-b6f3-4f5c57f01875'),
      ),
    ).toMatchObject({
      orderKey: 'm',
    })
  })

  it('leaves a project the user never dragged without a key', async () => {
    const { engine } = await createEngineWithProjects(['12c7943d-799e-4c27-b6f3-4f5c57f01875'])

    expect((await engine.shellSnapshot()).projects).toEqual([
      expect.objectContaining({ orderKey: null }),
    ])
  })

  it('refuses a reorder for a project that does not exist', async () => {
    const { engine } = await createEngineWithProjects(['12c7943d-799e-4c27-b6f3-4f5c57f01875'])

    await expect(
      engine.dispatch(reorderCommand('a0000000-0000-4000-8000-000000000099', 'm')),
    ).rejects.toMatchObject({
      code: 'orchestration.PROJECT_NOT_FOUND',
      status: 404,
    })
  })

  it('refuses a reorder that raced the delete of its project', async () => {
    const { engine } = await createEngineWithProjects(['12c7943d-799e-4c27-b6f3-4f5c57f01875'])
    await engine.dispatch(
      command({ projectId: '12c7943d-799e-4c27-b6f3-4f5c57f01875', type: 'project.delete' }),
    )

    await expect(
      engine.dispatch(reorderCommand('12c7943d-799e-4c27-b6f3-4f5c57f01875', 'm')),
    ).rejects.toMatchObject({
      code: 'orchestration.PROJECT_NOT_FOUND',
      status: 404,
    })
  })

  it('refuses a malformed key instead of persisting a row that sorts wrong', async () => {
    const { database, engine } = await createEngineWithProjects([
      '12c7943d-799e-4c27-b6f3-4f5c57f01875',
    ])

    // Bypasses the wire schema the way an internal dispatch would: the decider
    // is the guard that has to hold, because a persisted bad key is permanent.
    await expect(
      engine.dispatch({
        commandId: v.parse(commandIdSchema, 'cmd-malformed'),
        orderKey: 'Ba',
        projectId: v.parse(projectIdSchema, '12c7943d-799e-4c27-b6f3-4f5c57f01875'),
        type: 'project.reorder',
      }),
    ).rejects.toMatchObject({ code: 'orchestration.ORDER_KEY_INVALID', status: 400 })
    expect(projectRow(database, '12c7943d-799e-4c27-b6f3-4f5c57f01875').orderKey).toBeNull()
  })

  it('refuses a malformed key at the wire schema too', () => {
    expect(() =>
      v.parse(clientOrchestrationCommandSchema, {
        commandId: 'cmd-1',
        orderKey: 'ba',
        projectId: '12c7943d-799e-4c27-b6f3-4f5c57f01875',
        type: 'project.reorder',
      }),
    ).toThrow()
  })

  it('lands two interleaved drags on one deterministic order', async () => {
    const { database, engine } = await createEngineWithProjects([
      '12c7943d-799e-4c27-b6f3-4f5c57f01875',
      'a0000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000003',
    ])
    await engine.dispatch(reorderCommand('12c7943d-799e-4c27-b6f3-4f5c57f01875', 'b'))
    await engine.dispatch(reorderCommand('a0000000-0000-4000-8000-000000000002', 'd'))
    await engine.dispatch(reorderCommand('a0000000-0000-4000-8000-000000000003', 'f'))

    // Two drags planned against the SAME view of the list, applied one after
    // the other: each writes one key to one row, so neither can clobber the
    // other's slot and the result does not depend on the interleaving.
    const between = orderKeyBetween('b', 'd')
    const top = orderKeyBetween(null, 'b')
    await engine.dispatch(reorderCommand('a0000000-0000-4000-8000-000000000003', between!))
    await engine.dispatch(reorderCommand('a0000000-0000-4000-8000-000000000002', top!))

    expect(arrangedProjectIds(database)).toEqual([
      'a0000000-0000-4000-8000-000000000002',
      '12c7943d-799e-4c27-b6f3-4f5c57f01875',
      'a0000000-0000-4000-8000-000000000003',
    ])
    expect((await engine.shellSnapshot()).projects.map((project) => project.orderKey)).toEqual(
      expect.arrayContaining([top, 'b', between]),
    )
  })
})

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

/** The project list as the client renders it: keys compared as plain strings. */
function arrangedProjectIds(database: TestDatabase) {
  const rows = database.select().from(projectionProjects).orderBy(projectionProjects.orderKey).all()

  return rows.map((row) => row.projectId)
}

function projectRow(database: TestDatabase, projectId: string) {
  return database
    .select()
    .from(projectionProjects)
    .where(eq(projectionProjects.projectId, projectId))
    .get()!
}

function reorderCommand(projectId: string, orderKey: string) {
  return command({ orderKey, projectId, type: 'project.reorder' })
}

/** Every command needs its own id; the engine dedupes by receipt otherwise. */
function command(value: Record<string, unknown>) {
  commandCounter += 1

  return v.parse(orchestrationCommandSchema, {
    commandId: `cmd-${commandCounter}`,
    ...value,
  })
}

async function createEngineWithProjects(projectIds: readonly string[]) {
  const { database, engine } = createDomainEngine()
  for (const [index, projectId] of projectIds.entries()) {
    await engine.dispatch(
      projectRegistrationCommand(index + 1, { projectId: v.parse(projectIdSchema, projectId) }),
    )
  }
  return { database, engine }
}
