import { createRoute } from '@tanstack/react-router'
import { environmentIdSchema } from '@workspace/contracts'
import { parseWorkspaceToken } from '@workspace/client-core/address/workspace'
import * as v from 'valibot'
import { rootRoute } from '@/state/routes/root'

export const workspaceParamSchema = v.pipe(
  v.string(),
  v.check((value) => parseWorkspaceToken(value).kind !== 'invalid', 'Invalid workspace token'),
)
const localParams = v.object({ workspace: workspaceParamSchema })
const remoteParams = v.object({
  environmentId: environmentIdSchema,
  workspace: workspaceParamSchema,
})

export const localWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '~{$workspace}',
  params: { parse: (params) => v.parse(localParams, params), stringify: (params) => params },
})

export const remoteWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '@{$environmentId}/~{$workspace}',
  params: { parse: (params) => v.parse(remoteParams, params), stringify: (params) => params },
})
