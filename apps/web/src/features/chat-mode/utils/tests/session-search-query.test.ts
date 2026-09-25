import { orchestrationDispatchResultSchema } from '@workspace/contracts'
import { projectRegistrationResult } from '@workspace/client-core/chat/registration'
import { unwrapEdenResponse } from '@/lib/eden-events'
import type { Client } from '@/lib/client'
import { providerInstanceIdSchema, type ModelSelection } from '@workspace/contracts'
import { createTestQueryClient } from '../../../../../test/render'
import * as v from 'valibot'

import {
  createDraftSessionSubmission,
  createWorkspaceProjectCommand,
} from '@workspace/client-core/chat/commands'
import {
  isSessionSearchQuery,
  sessionSearchQueryOptions,
} from '@/features/chat-mode/utils/session-search-query'
import { expect, test } from '../../../../../test/fixtures'

// Real server, real routes: the point of this seam is that the rail can find a
// phrase the projection window no longer carries, which only the database knows.

const modelSelection: ModelSelection = {
  model: 'claude-opus-5',
  providerInstanceId: v.parse(providerInstanceIdSchema, 'claude'),
}

test('a phrase typed into a session is found by searching the messages', async ({
  client,
  server,
}) => {
  const registration = await seedSession(
    client,
    server.root,
    'The tokenizer fast path drops surrogate pairs.',
  )

  const result = await runSearch('surrogate pairs')

  expect(result.matches).toHaveLength(1)
  expect(result.matches[0]?.snippet).toContain('surrogate pairs')
  expect(result.matches[0]?.source).toBe('user')
  expect(result.matches[0]?.projectId).toBe(registration.projectId)
})

test('a phrase nobody wrote finds nothing', async ({ client, server }) => {
  await seedSession(client, server.root, 'The tokenizer fast path drops surrogate pairs.')

  expect((await runSearch('pelican crossing')).matches).toEqual([])
})

test('a one-character query never leaves the browser', ({ client }) => {
  expect(client).toBeDefined()
  expect(isSessionSearchQuery('a')).toBe(false)
  expect(isSessionSearchQuery('  a  ')).toBe(false)
  expect(isSessionSearchQuery('ab')).toBe(true)
  expect(sessionSearchQueryOptions({ query: 'a' }).enabled).toBe(false)
  expect(sessionSearchQueryOptions({ query: 'ab' }).enabled).toBe(true)
})

test('surrounding whitespace does not mint a second cache entry', ({ client }) => {
  expect(client).toBeDefined()

  expect(sessionSearchQueryOptions({ query: '  tokenizer ' }).queryKey).toEqual(
    sessionSearchQueryOptions({ query: 'tokenizer' }).queryKey,
  )
})

function runSearch(query: string) {
  // A throwaway client per call so a cached answer can never stand in for a
  // real round trip.
  return createTestQueryClient().query(sessionSearchQueryOptions({ query }))
}

async function seedSession(client: Client, rootPath: string, text: string) {
  const response = await dispatch(client, createWorkspaceProjectCommand({ rootPath }))
  const registration = projectRegistrationResult(
    v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(response, {
        requireData: true,
        normalizeDates: true,
        emptyMessage: 'missing registration',
      }),
    ),
  )
  const submission = createDraftSessionSubmission({
    createdAt: new Date().toISOString(),
    modelSelection,
    worktreeTarget: { kind: 'current', worktreeId: registration.worktreeId },
    text,
  })

  await dispatch(client, submission.command)
  return registration
}

async function dispatch(
  client: { orchestration: { commands: { post: Function } } },
  command: unknown,
) {
  const response = await client.orchestration.commands.post(command)
  expect(response.error).toBeNull()

  return response
}
