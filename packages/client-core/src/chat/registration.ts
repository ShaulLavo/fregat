import {
  commandIdSchema,
  type OrchestrationDispatchResult,
  type ProjectCreateCommand,
} from '@workspace/contracts'
import * as v from 'valibot'
import { createClientError } from '../errors'

export function createProjectRegistrationCommand({
  workspaceRoot,
  title,
}: {
  workspaceRoot: string
  title: string
}): ProjectCreateCommand {
  return {
    commandId: v.parse(commandIdSchema, `command-${crypto.randomUUID()}`),
    defaultModelSelection: null,
    title,
    type: 'project.create',
    workspaceRoot,
  }
}

export function projectRegistrationResult(receipt: OrchestrationDispatchResult) {
  if (receipt.result) return receipt.result
  throw createClientError({
    code: 'CHAT_PROJECT_IDENTITY_MISSING',
    status: 502,
    message: 'The project was added, but the server did not say which folder it uses.',
    why: "The server's answer to adding the project was missing its folder.",
    fix: 'Refresh the project list, then try again.',
  })
}
