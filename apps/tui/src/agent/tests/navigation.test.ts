import { createHistory } from '@/navigation/state/history'
import { agentAddress, resolveAddress } from '@/navigation/utils/address'
import {
  createWorkspaceProjectCommand,
  createDraftSessionSubmission,
} from '@workspace/client-core/chat/commands'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { projectIdSchema, sessionIdSchema, worktreeIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

const first = v.parse(sessionIdSchema, '11111111-1111-4111-8111-111111111111')
const second = v.parse(sessionIdSchema, '22222222-2222-4222-8222-222222222222')

test('agent and workbench history preserve session identity in both directions', () => {
  const home = { kind: 'agent', projectId: null, sessionId: first } as const
  const history = createHistory(home)
  const workbench = {
    kind: 'workbench',
    rootPath: 'project',
    pane: 'files',
    path: 'project/a.ts',
  } as const
  history.visit(workbench)
  history.visit({ ...home, sessionId: second })
  expect(history.go(-1)).toEqual(workbench)
  expect(history.go(-1)).toEqual(home)
  expect(history.go(1)).toEqual(workbench)
  expect(history.go(1)).toMatchObject({ sessionId: second })
})

test('real registered project and session addresses round-trip without changing the file root', async ({
  server,
  client,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  try {
    const ready = session.getSnapshot()
    if (ready.kind !== 'ready') return expect.unreachable('Expected ready environment')
    const registered = await ready.chat.dispatch(
      createWorkspaceProjectCommand({ rootPath: server.root }),
    )
    const { projectId, worktreeId } = v.parse(
      v.object({ projectId: projectIdSchema, worktreeId: worktreeIdSchema }),
      registered.result,
    )
    const providers = await client.providers.get()
    const provider = providers.data?.providers[0]
    if (!provider) return expect.unreachable('Expected fixture provider')
    const model = provider.models[0]
    if (!model) return expect.unreachable('Expected fixture model')
    const submission = createDraftSessionSubmission({
      createdAt: new Date().toISOString(),
      text: 'Address round trip',
      modelSelection: { providerInstanceId: provider.providerInstanceId, model: model.slug },
      worktreeTarget: { kind: 'current', worktreeId },
    })
    await ready.chat.dispatch(submission.command)
    const location = { kind: 'agent', projectId, sessionId: submission.command.sessionId } as const
    const address = await agentAddress(
      ready.descriptor.environmentId,
      location,
      { client, signal: session.signal },
      ready.chat.getSnapshot().projection,
    )
    expect(
      await resolveAddress(address, client, ready.descriptor.environmentId, session.signal),
    ).toEqual(location)
    const draft = { ...location, sessionId: null, worktreeId }
    expect(
      await resolveAddress(
        await agentAddress(
          ready.descriptor.environmentId,
          draft,
          { client, signal: session.signal },
          ready.chat.getSnapshot().projection,
        ),
        client,
        ready.descriptor.environmentId,
        session.signal,
      ),
    ).toEqual(draft)
    expect(
      await resolveAddress(
        address.replace(submission.command.sessionId, first),
        client,
        ready.descriptor.environmentId,
        session.signal,
      ),
    ).toMatchObject({ kind: 'failed' })
  } finally {
    session.dispose()
    await session.flush()
  }
})
