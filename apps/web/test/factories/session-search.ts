import {
  orchestrationDispatchResultSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
  type SessionId,
} from '@workspace/contracts'
import { projectRegistrationResult } from '@workspace/client-core/chat/registration'
import {
  createDraftSessionSubmission,
  createWorkspaceProjectCommand,
} from '@workspace/client-core/chat/commands'
import { unwrapEdenResponse } from '@/lib/eden-events'
import type { Client } from '@/lib/client'
import * as v from 'valibot'

export async function seedSearchSession(
  client: Client,
  rootPath: string,
  sessionId: SessionId,
  text: string,
) {
  const response = await client.orchestration.commands.post(
    createWorkspaceProjectCommand({ rootPath }),
  )
  const registration = projectRegistrationResult(
    v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(response, {
        requireData: true,
        normalizeDates: true,
        emptyMessage: 'Missing search fixture registration',
      }),
    ),
  )
  const submission = createDraftSessionSubmission({
    createdAt: new Date().toISOString(),
    modelSelection: { model: 'mock-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
    worktreeTarget: { kind: 'current', worktreeId: registration.worktreeId },
    text,
    title: 'Conversation',
  })
  const created = await client.orchestration.commands.post({ ...submission.command, sessionId })
  unwrapEdenResponse(created, { requireData: true, emptyMessage: 'Missing search fixture session' })
  return registration
}
