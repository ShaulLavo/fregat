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
    message: 'Project registration did not return its checkout identity.',
    why: 'The project command receipt omitted its registered checkout.',
    fix: 'Refresh the project list and inspect the server command receipt.',
  })
}
