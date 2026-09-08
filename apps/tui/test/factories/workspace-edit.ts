import path from 'node:path'
import * as v from 'valibot'
import { createRpcError } from '@workspace/client-core/transport/rpc-error'
import {
  nodeWorkspaceEditFileSystemDriver,
  type WorkspaceEditFileSystemDriver,
} from 'server/testing'
import { createTuiError } from '@/host/utils/structured-errors'
import { createInProcessClient, createInProcessFetcher } from '../client'
import type { TestServer } from '../server'

export function createWorkspaceEditFaults() {
  const failures = new Set<string>()
  const driver: WorkspaceEditFileSystemDriver = {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      if (failures.delete(path.basename(to)))
        throw createTuiError(
          'Injected filesystem rename failure.',
          'Retry after the injected failure.',
        )
      await nodeWorkspaceEditFileSystemDriver.rename(from, to)
    },
  }
  return { driver, failNextWrite: (filename: string) => failures.add(filename) }
}

export function loseNextWorkspaceEditResponse(server: TestServer, pathname: string) {
  const fetcher = createInProcessFetcher(server)
  let pending = true
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await fetcher(input, init)
      if (!pending || new URL(new Request(input, init).url).pathname !== pathname) return response
      pending = false
      return new Response('The response was lost.', { status: 503 })
    },
    { preconnect: () => undefined },
  )
}

export function rollbackBeforeFinalize(server: TestServer) {
  const fetcher = createInProcessFetcher(server)
  const api = createInProcessClient(server).fs['workspace-edit']
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname === '/fs/workspace-edit/finalize') {
        const body = v.parse(
          v.object({ operationId: v.string(), expectedGeneration: v.number() }),
          await request.clone().json(),
        )
        const rolledBack = await api.rollback.post({ ...body, transitionId: crypto.randomUUID() })
        if (rolledBack.error) throw createRpcError(rolledBack.error)
        const released = await api.release.post({
          operationId: body.operationId,
          expectedGeneration: rolledBack.data.generation,
          transitionId: crypto.randomUUID(),
        })
        if (released.error) throw createRpcError(released.error)
      }
      return fetcher(input, init)
    },
    { preconnect: () => undefined },
  )
}
