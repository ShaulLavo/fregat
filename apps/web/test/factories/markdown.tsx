import {
  ChatWorkspaceRootContext,
  type ChatWorkspaceRoot,
} from '@/features/chat/providers/workspace-root-context'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown'
import type { Client } from '@/lib/client'
import type { ApplicationRuntime } from '@/state/application-runtime'
import { renderWithProviders } from '../render'
import type { TestServer } from '../server'
import { createAddressTestRuntime } from './address-runtime'
import { TestEditorStateProvider } from './editor-state-provider'

export async function createMarkdownWorkspace(client: Client, server: TestServer) {
  await mkdir(path.join(server.root, 'repo/src/deep'), { recursive: true })
  await Promise.all([
    writeFile(path.join(server.root, 'repo/src/foo.ts'), 'export const foo = 1\n'),
    writeFile(path.join(server.root, 'repo/src/deep/mod.ts'), 'export const mod = 2\n'),
  ])
  const runtime = await createAddressTestRuntime(client)
  await runtime.application.openEnvironmentWorkspaceRoot(runtime.environmentId, 'repo')
  return runtime
}

export function renderMarkdown(
  text: string,
  {
    application,
    streaming = false,
    workspaceRoot = null,
  }: {
    readonly application?: ApplicationRuntime
    readonly streaming?: boolean
    readonly workspaceRoot?: ChatWorkspaceRoot | null
  } = {},
) {
  return renderWithProviders(
    <TestEditorStateProvider>
      <ChatWorkspaceRootContext value={workspaceRoot}>
        <AssistantMarkdown streaming={streaming} text={text} />
      </ChatWorkspaceRootContext>
    </TestEditorStateProvider>,
    { application },
  )
}
