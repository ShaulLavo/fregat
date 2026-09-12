import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  clientOrchestrationCommandSchema,
  healthDescriptorSchema,
  orchestrationCommandSchema,
  orchestrationDispatchResultSchema,
  orchestrationEventSchema,
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  type ProjectId,
  type SessionId,
  type WorktreeId,
} from '@workspace/contracts'
import {
  closeApp,
  MockProviderAdapter,
  OrchestrationEventStore,
  orchestrationForApp,
  type ProviderDiscoveredSession,
  type ProviderSessionDiscoveryInput,
} from 'server/testing'
import * as v from 'valibot'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { createInProcessClient } from '../client'
import { makeTestServer } from '../server'

export const DOMAIN_TIME = '2026-09-05T12:00:00.000Z'
export const DOMAIN_SESSION = v.parse(sessionIdSchema, '74596588-45ec-43ee-8d67-52e1d2d30e14')
export const AMBIGUOUS_SESSION = v.parse(sessionIdSchema, 'a73ab4f9-f695-4b87-8254-10111fdf7280')
export const TERMINAL_SESSION = v.parse(sessionIdSchema, 'd2d0b445-0c79-4ed5-a10e-3ed82021124e')
export const DOMAIN_MODEL = {
  providerInstanceId: v.parse(providerInstanceIdSchema, 'claude'),
  model: 'mock-model',
}

export class MetadataProviderAdapter extends MockProviderAdapter {
  rows: ProviderDiscoveredSession[] = []

  constructor(options: { stopError?: string } = {}) {
    super({
      ...options,
      driverKind: v.parse(providerDriverKindSchema, 'claude'),
      providerInstanceId: DOMAIN_MODEL.providerInstanceId,
    })
  }

  async discoverSessions(input: ProviderSessionDiscoveryInput) {
    return this.rows.slice(input.offset, input.offset + input.limit)
  }

  async readSessionHistory({ sessionId }: { readonly sessionId: SessionId }) {
    return this.rows
      .filter((row) => row.sessionId === sessionId)
      .map((row) => ({
        sourceId: `${row.sessionId}:user`,
        role: 'user' as const,
        text: 'Existing terminal conversation',
        createdAt: DOMAIN_TIME,
      }))
  }
}

export async function makeSessionDomainFixture(options: { providerRuntime?: boolean } = {}) {
  const adapter = new MetadataProviderAdapter()
  const server = await makeTestServer({
    filesystemWatch: false,
    persistentDatabase: true,
    providerAdapter: adapter,
    providerRuntime: options.providerRuntime ?? false,
  })
  const client = createInProcessClient(server)
  const main = path.join(server.root, 'main')
  const linked = path.join(server.root, 'linked')
  await mkdir(main)
  await executeDomainGit(main, 'init', '-b', 'main')
  await writeFile(path.join(main, 'keep.txt'), 'developer file')
  await executeDomainGit(main, 'add', 'keep.txt')
  await executeDomainGit(
    main,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'Initial',
  )
  await executeDomainGit(main, 'remote', 'add', 'origin', 'https://github.com/OpenAI/Platform.git')
  await executeDomainGit(main, 'worktree', 'add', '-b', 'feature', linked)
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  let nextCommand = 0
  const dispatch = async (input: unknown) => {
    const body = v.parse(clientOrchestrationCommandSchema, input)
    const response = await client.orchestration.commands.post(body)
    if (response.error) throw new TypeError(JSON.stringify(response.error.value))
    return v.parse(orchestrationDispatchResultSchema, response.data)
  }
  return {
    adapter,
    client,
    descriptor,
    linked,
    main,
    server,
    get engine() {
      return orchestrationForApp(server.app)
    },
    dispatch,
    internal: (input: unknown) =>
      orchestrationForApp(server.app).dispatch(v.parse(orchestrationCommandSchema, input)),
    register: (commandId = `register-${++nextCommand}`, workspaceRoot = 'main') =>
      dispatch({
        type: 'project.create',
        commandId,
        workspaceRoot,
        title: 'Platform',
        defaultModelSelection: DOMAIN_MODEL,
      }),
    createSession: (worktreeId: WorktreeId, sessionId: SessionId = DOMAIN_SESSION) =>
      dispatch({
        type: 'session.create',
        commandId: `create-${++nextCommand}`,
        sessionId,
        worktreeTarget: { kind: 'current', worktreeId: worktreeId },
        title: sessionId === DOMAIN_SESSION ? 'GUI session' : 'Ambiguous session',
        modelSelection: DOMAIN_MODEL,
      }),
    startTurn: (sessionId: SessionId = DOMAIN_SESSION, withImage = false) =>
      dispatch({
        type: 'session.turn.start',
        commandId: `turn-${++nextCommand}`,
        sessionId,
        turnId: `turn-${nextCommand}`,
        message: {
          messageId: `message-${nextCommand}`,
          role: 'user',
          text: 'Hello',
          attachments: withImage
            ? [
                {
                  type: 'image',
                  id: 'domain-image',
                  name: 'image.png',
                  mimeType: 'image/png',
                  sizeBytes: 3,
                  dataUrl: 'data:image/png;base64,YWJj',
                },
              ]
            : [],
        },
      }),
    snapshot: () => fetchOrchestrationShellSnapshotHttp(client),
    session: async (sessionId: SessionId = DOMAIN_SESSION) => {
      const session = (await orchestrationForApp(server.app).readModelSnapshot()).sessions.get(
        sessionId,
      )
      if (!session) throw new TypeError(`Missing fixture session ${sessionId}`)
      return session
    },
    appendUnapplied: async (projectId: ProjectId, count: number) => {
      await closeApp(server.app)
      const events = Array.from({ length: count }, (_, index) =>
        v.parse(orchestrationEventSchema, {
          sequence: 0,
          eventId: `catchup-${index}`,
          commandId: null,
          correlationId: null,
          causationEventId: null,
          metadata: {},
          actorKind: 'server',
          aggregateKind: 'project',
          aggregateId: projectId,
          occurredAt: DOMAIN_TIME,
          type: 'project.meta-updated',
          payload: { projectId, title: `Catchup ${index}`, updatedAt: DOMAIN_TIME },
        }),
      )
      return server.database.db.transaction(() =>
        new OrchestrationEventStore(server.database.db).append(events),
      )
    },
    blobPath: path.join(server.root, '.platform-test', 'attachments', 'domain-image.png'),
  }
}

export async function executeDomainGit(cwd: string, ...args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new TypeError(`Git fixture failed: ${error}`)
  return output.trim()
}
