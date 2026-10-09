import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { providerInstanceIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { McpConfigAdapter } from '../../../../test/factories/mcp-config'
import { McpConfigRow } from '@/features/settings/components/mcp-config-row'
import { providerSnapshot } from '../../../../test/factories/chat'
import { McpSection } from '@/features/settings/components/mcp-section'
import { expect, test } from '../../../../test/fixtures'
import { createInProcessClient } from '../../../../test/client'
import { installTestClient } from '../../../../test/factories/client-binding'
import { renderWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'

test('lists an instance on request, adds a command server with masked values, and deletes one', async () => {
  const adapter = new McpConfigAdapter()
  const server = await makeTestServer({ providerAdapter: adapter })
  const restore = installTestClient(createInProcessClient(server))
  const rendered = renderWithProviders(<McpSection />)
  try {
    const tab = await screen.findByRole('tab', { name: 'Claude' })
    expect(adapter.listed).toBe(0)
    await userEvent.click(tab)

    const linear = await screen.findByText('linear')
    const row = linear.closest('li')!
    expect(within(row).getByText('User · https://mcp.linear.app · 1 tool')).toBeVisible()
    expect(within(row).getByText('.claude.json')).toBeVisible()
    expect(within(row).getByText('/home/dev')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Plugin' })).toBeVisible()
    const github = screen.getByText('github').closest('li')!
    expect(within(github).queryByRole('button', { name: 'Remove' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Add server' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Name'), 'docs')
    await userEvent.type(within(dialog).getByLabelText('Command'), 'npx')
    await userEvent.type(within(dialog).getByLabelText('Arguments'), '-y "docs server"')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add variable' }))
    await userEvent.type(within(dialog).getByLabelText('Environment name 1'), 'TOKEN')
    const value = within(dialog).getByLabelText('Environment value 1')
    expect(value).toHaveAttribute('type', 'password')
    await userEvent.type(value, 'secret')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add server' }))

    expect(await screen.findByText('docs')).toBeVisible()
    expect(adapter.writes[0]).toMatchObject({
      definition: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'docs server'],
        env: { TOKEN: 'secret' },
      },
      name: 'docs',
      scope: 'user',
    })

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    const confirm = await screen.findByRole('dialog')
    await userEvent.click(within(confirm).getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(screen.queryByText('linear')).toBeNull())
    expect(adapter.writes[1]).toMatchObject({ name: 'linear', scope: 'user' })
  } finally {
    rendered.unmount()
    restore()
    await server.cleanup()
  }
})

test('refuses the reserved name before anything is written', async () => {
  const adapter = new McpConfigAdapter()
  const server = await makeTestServer({ providerAdapter: adapter })
  const restore = installTestClient(createInProcessClient(server))
  const rendered = renderWithProviders(<McpSection />)
  try {
    await userEvent.click(await screen.findByRole('tab', { name: 'Claude' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add server' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Name'), 'platform')
    await userEvent.type(within(dialog).getByLabelText('Command'), 'npx')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add server' }))

    expect(await within(dialog).findByText(/reserved for Fregat/)).toBeVisible()
    expect(adapter.writes).toEqual([])
  } finally {
    rendered.unmount()
    restore()
    await server.cleanup()
  }
})

test('offers copying approved rows and hides copying on unapproved project rows', async () => {
  const instance = providerSnapshot({
    providerInstanceId: v.parse(providerInstanceIdSchema, 'claude'),
  })
  const target = providerSnapshot({
    providerInstanceId: v.parse(providerInstanceIdSchema, 'codex'),
  })
  const server = {
    ...new McpConfigAdapter().servers[0]!,
    name: 'deploy',
    scope: 'project' as const,
  }
  const rendered = renderWithProviders(
    <McpConfigRow
      folder='/repo'
      instance={instance}
      instances={[instance, target]}
      server={server}
    />,
  )
  expect(screen.getByRole('button', { name: 'Also add deploy to…' })).toBeVisible()
  rendered.rerender(
    <McpConfigRow
      folder='/repo'
      instance={instance}
      instances={[instance, target]}
      server={{ ...server, status: 'unapproved' }}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Also add deploy to…' })).toBeNull()
})

test.for(['remove', 'add', 'copy', 'sign-in'] as const)(
  'keeps %s on the displayed provider while another provider is loading',
  async (action) => {
    const first = new McpConfigAdapter({ label: 'Claude A' })
    const second = new McpConfigAdapter({ id: 'codex', label: 'Codex B', driver: 'codex' })
    first.servers[0]!.status = 'needs-auth'
    second.servers[0]!.origin = 'https://b.example.test'
    second.mcpConfig.scopes = ['user']
    const server = await makeTestServer({ providerAdapter: first })
    await server.restart({ additionalProviderAdapters: [second] })
    const restore = installTestClient(createInProcessClient(server))
    const rendered = renderWithProviders(<McpSection />)
    const held = second.holdLists()
    try {
      await userEvent.click(await screen.findByRole('tab', { name: 'Claude A' }))
      const row = (await screen.findByText('linear')).closest('li')!
      await userEvent.click(screen.getByRole('tab', { name: 'Codex B' }))
      await held.entered
      expect(within(row).getByText(/mcp.linear.app/)).toBeVisible()
      if (action === 'remove') {
        await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
        await userEvent.click(
          within(await screen.findByRole('dialog')).getByRole('button', { name: /Delete/ }),
        )
        await waitFor(() => expect(first.writes).toHaveLength(1))
      }
      if (action === 'add') {
        await userEvent.click(screen.getByRole('button', { name: 'Add server' }))
        const dialog = await screen.findByRole('dialog')
        await userEvent.type(within(dialog).getByLabelText('Name'), 'docs')
        await userEvent.type(within(dialog).getByLabelText('Command'), 'fixture')
        await userEvent.click(within(dialog).getByRole('button', { name: 'Add server' }))
        await waitFor(() => expect(first.writes).toHaveLength(1))
      }
      if (action === 'copy') {
        await userEvent.click(within(row).getByRole('button', { name: 'Also add linear to…' }))
        await userEvent.click(await screen.findByRole('menuitem', { name: 'Also add to Codex B' }))
        await waitFor(() => expect(first.reads).toHaveLength(1))
        expect(second.writes[0]?.definition).toMatchObject({ command: 'claude' })
      }
      if (action === 'sign-in') {
        await userEvent.click(within(row).getByRole('button', { name: 'Sign in' }))
        await waitFor(() => expect(first.signIns).toHaveLength(1))
        expect(second.signIns).toEqual([])
      }
      expect(screen.getByRole('tab', { name: 'Claude A', hidden: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(
        screen.getByRole('region', { name: 'Claude A MCP servers', hidden: true }),
      ).toBeVisible()
      held.release()
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: 'Codex B' })).toHaveAttribute(
          'aria-selected',
          'true',
        ),
      )
      expect(await screen.findByText(/b.example.test/)).toBeVisible()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByRole('link', { name: 'Open sign-in page for linear' })).toBeNull()
      if (action !== 'copy') expect(second.writes).toEqual([])
    } finally {
      held.release()
      rendered.unmount()
      restore()
      await server.cleanup()
    }
  },
)

test.for(['Remove', 'Add server'] as const)(
  'closes an open %s dialog when the new provider is ready, even with the same server name',
  async (action) => {
    const first = new McpConfigAdapter({ label: 'Claude A' })
    const second = new McpConfigAdapter({ id: 'codex', label: 'Codex B', driver: 'codex' })
    second.servers[0]!.origin = 'https://b.example.test'
    second.mcpConfig.scopes = ['user']
    const server = await makeTestServer({ providerAdapter: first })
    await server.restart({ additionalProviderAdapters: [second] })
    const restore = installTestClient(createInProcessClient(server))
    const rendered = renderWithProviders(<McpSection />)
    const held = second.holdLists()
    try {
      await userEvent.click(await screen.findByRole('tab', { name: 'Claude A' }))
      const row = (await screen.findByText('linear')).closest('li')!
      await userEvent.click(screen.getByRole('tab', { name: 'Codex B' }))
      await held.entered
      const trigger = action === 'Remove' ? within(row) : screen
      await userEvent.click(trigger.getByRole('button', { name: action }))
      const dialog = await screen.findByRole('dialog')
      if (action === 'Add server')
        await userEvent.type(within(dialog).getByLabelText('Name'), 'old-draft')
      held.release()
      await screen.findByText(/b.example.test/)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await userEvent.click(screen.getByRole('button', { name: 'Add server' }))
      expect(within(await screen.findByRole('dialog')).getByLabelText('Name')).toHaveValue('')
      expect(first.writes.concat(second.writes)).toEqual([])
    } finally {
      held.release()
      rendered.unmount()
      restore()
      await server.cleanup()
    }
  },
)

test('keeps folder, scopes and removal with the displayed list until the selected folder is read', async () => {
  const adapter = new McpConfigAdapter()
  const server = await makeTestServer({ providerAdapter: adapter })
  const folder = path.join(server.root, 'second')
  await mkdir(folder)
  adapter.folders.set('second', [{ ...adapter.servers[0]!, origin: 'https://second.example.test' }])
  const restore = installTestClient(createInProcessClient(server))
  const rendered = renderWithProviders(<McpSection />)
  let release = () => {}
  try {
    await userEvent.click(await screen.findByRole('tab', { name: 'Claude' }))
    const row = (await screen.findByText('linear')).closest('li')!
    const held = adapter.holdLists()
    release = held.release
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    const picker = await screen.findByRole('dialog', { name: 'Choose folder' })
    await userEvent.click(within(picker).getByRole('button', { name: 'Go to folder' }))
    const input = within(picker).getByRole('textbox', { name: 'Folder path' })
    await userEvent.clear(input)
    await userEvent.type(input, `${folder}{Enter}`)
    await waitFor(() => expect(input).not.toBeVisible())
    await waitFor(() =>
      expect(within(picker).getByRole('button', { name: /^Open$/ })).toBeEnabled(),
    )
    await userEvent.click(within(picker).getByRole('button', { name: /^Open$/ }))
    await held.entered
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete linear?' })
    await userEvent.click(within(dialog).getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    expect(adapter.writes[0]).toMatchObject({
      folder: adapter.listFolders[0],
      name: 'linear',
      scope: 'user',
    })
    expect(screen.getByText('Home folder')).toBeVisible()
    held.release()
    expect(await screen.findByText(/second.example.test/)).toBeVisible()
    expect(adapter.folders.get('second')).toHaveLength(1)
    expect(screen.getByText('second', { selector: '[data-mcp-folder]' })).toBeVisible()
  } finally {
    release()
    rendered.unmount()
    restore()
    await server.cleanup()
  }
})
