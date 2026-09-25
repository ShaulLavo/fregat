import { Elysia } from 'elysia'
import {
  providerBackgroundTasksSchema,
  sessionIdSchema,
  trimmedNonEmptyStringSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { ProviderService } from './provider-service'

const sessionParamsSchema = v.object({ sessionId: sessionIdSchema })
const taskParamsSchema = v.object({
  sessionId: sessionIdSchema,
  taskId: trimmedNonEmptyStringSchema,
})

/** A session's live background tasks, read from the provider that runs them. */
export function sessionTaskRoutes(providerService: ProviderService) {
  return new Elysia({ name: 'session-task-routes' })
    .get(
      '/providers/sessions/:sessionId/background-tasks',
      ({ params }) => providerService.backgroundTaskRoster(params.sessionId),
      { params: sessionParamsSchema, response: providerBackgroundTasksSchema },
    )
    .post(
      '/providers/sessions/:sessionId/background-tasks/:taskId/stop',
      async ({ params }) => {
        await providerService.stopBackgroundTask(params)
        return providerService.backgroundTaskRoster(params.sessionId)
      },
      { params: taskParamsSchema, response: providerBackgroundTasksSchema },
    )
}
