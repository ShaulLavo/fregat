import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { workspaceAddressSchema } from '@workspace/contracts'
import type { WideEvent } from 'evlog'
import { readFsLogs } from 'evlog/fs'
import * as v from 'valibot'
import { afterEach, expect } from 'vitest'
import { test, workspaceRequest as request } from '../../../test/factories/workspace-address'
import type { createTestApp } from '../../../test/server'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'

afterEach(() => resetObservabilityForTests())

test('answers found and missing candidates in one call and prunes the missing recent', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'packages/library'), { recursive: true })
  await mkdir(path.join(workspace.root, 'project'))
  await mkdir(path.join(workspace.root, 'gone'))
  await symlink('packages/library', path.join(workspace.root, 'alias'))
  await writeFile(path.join(workspace.root, 'file'), 'text')
  const app = workspace.openApp()
  for (const recent of ['project', 'gone']) {
    expect((await request(app, '/fs/recents', { path: recent })).status).toBe(200)
  }
  await rm(path.join(workspace.root, 'gone'), { recursive: true })

  const response = await request(app, '/fs/workspace-addresses', {
    paths: ['alias', 'gone', 'file', 'project', '../outside'],
  })

  expect(response.status).toBe(200)
  const project = v.parse(
    workspaceAddressSchema,
    await (await request(app, '/fs/workspace-address', { path: 'project' })).json(),
  )
  expect(await response.json()).toEqual({
    entries: [
      {
        path: 'alias',
        address: { id: expect.any(String), name: 'library', path: 'packages/library' },
      },
      { path: 'gone', address: null },
      { path: 'file', address: null },
      { path: 'project', address: project },
      { path: '../outside', address: null },
    ],
  })
  // Back on disk, a pruned recent stays out of the listing.
  await mkdir(path.join(workspace.root, 'gone'))
  expect(await recentPaths(app)).toEqual(['project'])
})

test('an unreadable candidate answers null without failing the others and logs at warn', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'locked/inner'), { recursive: true })
  await mkdir(path.join(workspace.root, 'open'))
  await chmod(path.join(workspace.root, 'locked'), 0o000)
  const logDir = observeInto(workspace.directory)
  const app = workspace.openApp()
  try {
    const response = await request(app, '/fs/workspace-addresses', {
      paths: ['locked/inner', 'open'],
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      entries: [
        { path: 'locked/inner', address: null },
        { path: 'open', address: { path: 'open' } },
      ],
    })
  } finally {
    await chmod(path.join(workspace.root, 'locked'), 0o755)
  }
  expect(await lookupEvent(logDir)).toMatchObject({
    failureCodes: ['OPERATION_FAILED'],
    level: 'warn',
    status: 200,
    unreadableCount: 1,
  })
})

test('a batch of missing candidates logs one info event', async ({ workspace }) => {
  await mkdir(path.join(workspace.root, 'gone'))
  const logDir = observeInto(workspace.directory)
  const app = workspace.openApp()
  expect((await request(app, '/fs/recents', { path: 'gone' })).status).toBe(200)
  await rm(path.join(workspace.root, 'gone'), { recursive: true })

  const response = await request(app, '/fs/workspace-addresses', { paths: ['gone', 'absent'] })

  expect(response.status).toBe(200)
  await response.text()
  const event = await lookupEvent(logDir)
  expect(event).toMatchObject({
    fs: {
      operations: [
        expect.objectContaining({
          failureCount: 2,
          operation: 'lookup_workspace_addresses',
          pathCount: 2,
          prunedCount: 1,
          status: 'ok',
        }),
      ],
    },
    level: 'info',
    status: 200,
  })
  expect(event).not.toHaveProperty('requestLogs')
})

test('a recents listing prunes the recents it finds missing', async ({ workspace }) => {
  await mkdir(path.join(workspace.root, 'kept'))
  await mkdir(path.join(workspace.root, 'stale'))
  const app = workspace.openApp()
  for (const recent of ['kept', 'stale']) {
    expect((await request(app, '/fs/recents', { path: recent })).status).toBe(200)
  }
  await rm(path.join(workspace.root, 'stale'), { recursive: true })
  expect(await recentPaths(app)).toEqual(['kept'])

  await mkdir(path.join(workspace.root, 'stale'))
  expect(await recentPaths(app)).toEqual(['kept'])
})

function observeInto(directory: string) {
  const logDir = path.join(directory, 'logs')
  initializeObservability({
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
  })
  return logDir
}

async function lookupEvent(logDir: string) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushObservability()
  const events: Array<WideEvent & Record<string, unknown>> = []
  for await (const event of readFsLogs({ dir: logDir })) {
    if (event.path === '/fs/workspace-addresses') events.push(event)
  }
  expect(events).toHaveLength(1)
  return events[0]
}

async function recentPaths(app: ReturnType<typeof createTestApp>) {
  const response = await request(app, '/fs/recents?mode=folder&showHidden=true')
  const payload = (await response.json()) as { entries: Array<{ path: string }> }
  return payload.entries.map((entry) => entry.path)
}
