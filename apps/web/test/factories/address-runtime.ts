import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { onTestFinished } from 'vitest'
import { createApplicationRuntime } from '@/state/application-runtime'
import { emptyWorkspaceState } from '@/features/workspace/state/cache'
import { createEditorApplyActions } from '@/features/editor/state/apply-actions'
import type { Client } from '@/lib/client'
import { scopeAddressEnvironment } from './address-environment'
import {
  queryClientFor,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'

export async function createAddressTestRuntime(client: Client) {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const restore = scopeAddressEnvironment(
    'http://localhost:38086',
    descriptor.environmentId,
    client,
  )
  registerEnvironmentQueryClient(
    queryClientFor('http://localhost:38086'),
    'http://localhost:38086',
    client,
  )
  const application = createApplicationRuntime({
    workspaceCache: emptyWorkspaceState(),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark',
      syntaxHighlightingEnabled: false,
    },
  })
  onTestFinished(() => {
    application.dispose()
    restore()
  })
  const editor = application.getSnapshot().editor
  const commands = createEditorApplyActions({
    retainedTextBudget: () => Number.MAX_SAFE_INTEGER,
    activation: editor.editorActivation,
    documentStore: editor.documentStore,
    searchStore: editor.searchBufferStore,
    uiStore: editor.uiStore,
    workspaceStore: editor.workspaceStore,
  })
  return { application, commands, editor, environmentId: descriptor.environmentId }
}
