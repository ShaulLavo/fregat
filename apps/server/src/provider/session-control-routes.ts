import { Elysia } from 'elysia'
import {
  providerBackgroundTasksSchema,
  providerMcpSignInSchema,
  providerSessionHooksSchema,
  providerSessionMcpSchema,
  sessionIdSchema,
  trimmedNonEmptyStringSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { ProviderService } from './provider-service'

const sessionParamsSchema = v.object({ sessionId: sessionIdSchema })
const serverParamsSchema = v.object({
  name: trimmedNonEmptyStringSchema,
  sessionId: sessionIdSchema,
})
const taskParamsSchema = v.object({
  sessionId: sessionIdSchema,
  taskId: trimmedNonEmptyStringSchema,
})

/** A session's live provider controls: background tasks, MCP servers and configured hooks. */
export function sessionControlRoutes(providerService: ProviderService) {
  return new Elysia({ name: 'session-control-routes' })
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
    .get(
      '/providers/sessions/:sessionId/mcp',
      ({ params }) => providerService.sessionMcp(params.sessionId),
      {
        params: sessionParamsSchema,
        response: providerSessionMcpSchema,
      },
    )
    .post(
      '/providers/sessions/:sessionId/mcp/:name/reconnect',
      ({ params }) => providerService.reconnectMcpServer(params),
      { params: serverParamsSchema, response: providerSessionMcpSchema },
    )
    .post(
      '/providers/sessions/:sessionId/mcp/:name/sign-in',
      ({ params }) => providerService.signInMcpServer(params),
      { params: serverParamsSchema, response: providerMcpSignInSchema },
    )
    .get(
      '/providers/sessions/:sessionId/hooks',
      ({ params }) => providerService.sessionHooks(params.sessionId),
      {
        params: sessionParamsSchema,
        response: providerSessionHooksSchema,
      },
    )
}
