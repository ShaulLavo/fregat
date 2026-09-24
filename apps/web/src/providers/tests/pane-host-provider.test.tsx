import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { act, screen, within } from '@testing-library/react'

import { usePaneHost } from '@/hooks/use-pane-host'
import { PaneHostProvider } from '@/providers/pane-host-provider'
import type { PaneHostKind } from '@/providers/pane-host-context'
import { waitForNavigation } from '../../../test/address'
import { createAddressTestRuntime } from '../../../test/factories/address-runtime'
import { expect, test } from '../../../test/fixtures'
import { renderApplication } from '../../../test/render'

function Probe({ kind }: { readonly kind: PaneHostKind }) {
  const host = usePaneHost()
  return (
    <section aria-label={kind} data-active={host?.activeView} data-visible={String(host?.visible)}>
      {host?.views.map((view) => (
        <span key={view.value}>
          <button type='button' onClick={view.select}>{`select ${view.label}`}</button>
          <button type='button' onClick={view.toggle}>{`toggle ${view.label}`}</button>
        </span>
      ))}
      <button type='button' onClick={host?.hide}>
        hide
      </button>
    </section>
  )
}

const KINDS = ['workbench-sidebar', 'workbench-bottom', 'chat-tools'] as const

async function renderHosts(client: Parameters<typeof createAddressTestRuntime>[0]) {
  const { application, editor, environmentId } = await createAddressTestRuntime(client)
  const rendered = renderApplication(
    <>
      {KINDS.map((kind) => (
        <PaneHostProvider key={kind} kind={kind}>
          <Probe kind={kind} />
        </PaneHostProvider>
      ))}
    </>,
    application,
  )
  await waitForNavigation(rendered.navigation)
  await rendered.navigation.openWorkspace({ environmentId, path: 'repo' })
  return { editor, navigation: rendered.navigation }
}

function host(kind: PaneHostKind) {
  return screen.getByRole('region', { name: kind })
}

async function press(kind: PaneHostKind, name: string) {
  await act(async () => within(host(kind)).getByRole('button', { name }).click())
}

test('each host lists only its own views', async ({ client, server }) => {
  await mkdir(path.join(server.root, 'repo'))
  await renderHosts(client)

  const labels = (kind: PaneHostKind) =>
    within(host(kind))
      .getAllByRole('button', { name: /^select / })
      .map((button) => button.textContent?.replace('select ', ''))
  expect(labels('workbench-sidebar')).toEqual(['Files', 'Git', 'Search', 'Logs', 'Chat'])
  expect(labels('workbench-bottom')).toEqual(['Terminal', 'Problems'])
  expect(labels('chat-tools')).toEqual([
    'Git',
    'Files',
    'Editor',
    'Search',
    'Terminal',
    'Problems',
    'Logs',
  ])
})

test('hiding keeps the last view, and the rail toggle reopens on it', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'repo'))
  const { editor } = await renderHosts(client)

  await press('workbench-sidebar', 'select Git')
  await press('workbench-sidebar', 'hide')
  expect(editor.workspaceStore.getState().workbenchPanels).toMatchObject({
    activeSidebarTab: 'git',
    sidebarOpen: false,
  })
  expect(host('workbench-sidebar')).toHaveAttribute('data-visible', 'false')

  await press('workbench-sidebar', 'toggle Git')
  expect(host('workbench-sidebar')).toHaveAttribute('data-visible', 'true')
  expect(host('workbench-sidebar')).toHaveAttribute('data-active', 'git')

  await press('workbench-sidebar', 'toggle Git')
  expect(host('workbench-sidebar')).toHaveAttribute('data-visible', 'false')
})

test('hiding one host leaves the others open', async ({ client, server }) => {
  await mkdir(path.join(server.root, 'repo'))
  const { editor } = await renderHosts(client)

  await press('workbench-bottom', 'select Problems')
  await press('workbench-bottom', 'hide')
  await press('chat-tools', 'select Logs')
  await press('chat-tools', 'hide')

  const state = editor.workspaceStore.getState()
  expect(state.workbenchPanels).toMatchObject({
    activeBottomTab: 'problems',
    bottomPanelOpen: false,
    sidebarOpen: true,
  })
  expect(state.chatModePanels).toMatchObject({ activeToolTab: 'logs', toolPaneOpen: false })
})

test('selecting a view reveals a hidden host', async ({ client, server }) => {
  await mkdir(path.join(server.root, 'repo'))
  const { editor } = await renderHosts(client)

  await press('chat-tools', 'hide')
  await press('chat-tools', 'select Search')

  expect(editor.workspaceStore.getState().chatModePanels).toMatchObject({
    activeToolTab: 'search',
    toolPaneOpen: true,
  })
})
