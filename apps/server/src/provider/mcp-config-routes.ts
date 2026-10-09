import { Elysia } from 'elysia'
import {
  providerInstanceIdSchema,
  providerInstanceMcpQuerySchema,
  providerInstanceMcpSchema,
  providerMcpAddBodySchema,
  providerMcpCopyBodySchema,
  providerMcpRemoveBodySchema,
  providerMcpServerNameSchema,
  providerMcpSignInAttemptSchema,
  providerMcpSignInBodySchema,
  providerMcpSignInFinishBodySchema,
  providerMcpSignInSchema,
  type ProviderInstanceId,
  type ProviderMcpScope,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { WorkspacePaths } from '../fs/path'
import { recordChatPipelineInfo } from '../orchestration/orchestration-logging'
import { providerErrors } from '../observability/structured-errors'
import type { McpSignInAttempts } from './mcp-sign-in'
import type { ProviderAdapterRegistry } from './provider-adapter-registry'
import { mcpConfigErrors } from './structured-errors'

const instanceParamsSchema = v.object({ providerInstanceId: providerInstanceIdSchema })
const attemptParamsSchema = v.object({ attemptId: v.pipe(v.string(), v.uuid()) })
const serverParamsSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  name: providerMcpServerNameSchema,
})

/**
 * Settings › MCP servers: each instance's servers as its harness keeps them. Writes go through the
 * harness's own writer, so Platform stores no server list of its own.
 */
export function mcpConfigRoutes(
  adapterRegistry: ProviderAdapterRegistry,
  signIns: McpSignInAttempts,
  { paths, homePath }: { readonly paths: WorkspacePaths; readonly homePath: string },
) {
  const resolveFolder = (folder: string | null | undefined) =>
    paths.resolve(folder ?? homePath).absolutePath
  const writeFolder = (
    scopes: readonly ProviderMcpScope[],
    scope: ProviderMcpScope,
    folder: string | null,
  ) => {
    if (!scopes.includes(scope))
      throw mcpConfigErrors.MCP_SCOPE_UNSUPPORTED({ internal: { scope } })
    if (scope !== 'user' && folder === null)
      throw mcpConfigErrors.MCP_FOLDER_REQUIRED({ internal: { scope } })
    return resolveFolder(folder)
  }

  const access = (providerInstanceId: ProviderInstanceId) => {
    const adapter = adapterRegistry.adapter(providerInstanceId)
    if (!adapter) throw providerErrors.INSTANCE_NOT_FOUND({ providerInstanceId })
    if (!adapter.mcpConfig)
      throw mcpConfigErrors.MCP_CONFIG_UNSUPPORTED({ internal: { providerInstanceId } })

    return adapter.mcpConfig
  }

  return new Elysia({ name: 'mcp-config-routes' })
    .get(
      '/providers/:providerInstanceId/mcp',
      async ({ params, query }) => {
        const config = access(params.providerInstanceId)
        const folder = resolveFolder(query.folder)
        return { folder, scopes: [...config.scopes], servers: await config.list({ folder }) }
      },
      {
        params: instanceParamsSchema,
        query: providerInstanceMcpQuerySchema,
        response: providerInstanceMcpSchema,
      },
    )
    .post(
      '/providers/:providerInstanceId/mcp',
      async ({ body, params }) => {
        const config = access(params.providerInstanceId)
        const folder = writeFolder(config.scopes, body.scope, body.folder)
        recordChatPipelineInfo('chat.pipeline.mcp_config.add', {
          name: body.name,
          providerInstanceId: params.providerInstanceId,
          scope: body.scope,
          transport: body.definition.transport,
        })
        await config.add({
          definition: body.definition,
          folder,
          name: body.name,
          scope: body.scope,
        })
      },
      { body: providerMcpAddBodySchema, params: instanceParamsSchema },
    )
    .delete(
      '/providers/:providerInstanceId/mcp/:name',
      async ({ body, params }) => {
        const config = access(params.providerInstanceId)
        const folder = writeFolder(config.scopes, body.scope, body.folder)
        recordChatPipelineInfo('chat.pipeline.mcp_config.remove', {
          name: params.name,
          providerInstanceId: params.providerInstanceId,
          scope: body.scope,
        })
        await config.remove({ folder, name: params.name, scope: body.scope })
      },
      { body: providerMcpRemoveBodySchema, params: serverParamsSchema },
    )
    .post(
      '/providers/:providerInstanceId/mcp/:name/sign-in',
      async ({ body, params }) => {
        const config = access(params.providerInstanceId)
        recordChatPipelineInfo('chat.pipeline.mcp_config.sign_in', {
          name: params.name,
          providerInstanceId: params.providerInstanceId,
        })
        const flow = await config.signIn({ folder: resolveFolder(body.folder), name: params.name })
        return signIns.start(params.name, flow)
      },
      {
        body: providerMcpSignInBodySchema,
        params: serverParamsSchema,
        response: providerMcpSignInSchema,
      },
    )
    .get('/providers/mcp-sign-in/:attemptId', ({ params }) => signIns.read(params.attemptId), {
      params: attemptParamsSchema,
      response: providerMcpSignInAttemptSchema,
    })
    .post(
      '/providers/mcp-sign-in/:attemptId',
      ({ body, params }) => signIns.finish(params.attemptId, body.callbackUrl),
      {
        body: providerMcpSignInFinishBodySchema,
        params: attemptParamsSchema,
        response: providerMcpSignInAttemptSchema,
      },
    )
    .post(
      '/providers/:providerInstanceId/mcp/:name/copy',
      async ({ body, params }) => {
        const source = access(params.providerInstanceId)
        const target = access(body.target.providerInstanceId)
        const folder = writeFolder(source.scopes, body.scope, body.folder)
        const targetScope =
          body.target.scope ?? (target.scopes.includes(body.scope) ? body.scope : 'user')
        const targetFolder = writeFolder(target.scopes, targetScope, body.folder)
        recordChatPipelineInfo('chat.pipeline.mcp_config.copy', {
          name: params.name,
          providerInstanceId: params.providerInstanceId,
          scope: body.scope,
          targetProviderInstanceId: body.target.providerInstanceId,
          targetScope,
        })
        const definition = await source.read({ folder, name: params.name, scope: body.scope })
        await target.add({
          definition,
          folder: targetFolder,
          name: params.name,
          scope: targetScope,
        })
      },
      { body: providerMcpCopyBodySchema, params: serverParamsSchema },
    )
}
