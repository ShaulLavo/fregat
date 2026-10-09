import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  type ProviderMcpConfigServer,
  type ProviderMcpDefinition,
  type ProviderMcpScope,
} from '@workspace/contracts'
import { MockProviderAdapter } from 'server/testing'
import * as v from 'valibot'

import { McpConfigRow } from '@/features/settings/components/mcp-config-row'
import { providerSnapshot } from '../../../../test/factories/chat'
import { McpSection } from '@/features/settings/components/mcp-section'
import { expect, test } from '../../../../test/fixtures'
import { createInProcessClient } from '../../../../test/client'
import { installTestClient } from '../../../../test/factories/client-binding'
import { renderWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'

type Write = { folder: string; name: string; scope: ProviderMcpScope }

/** A Claude instance whose config lives in memory: the probe and `claude mcp` stand-ins. */
class McpConfigAdapter extends MockProviderAdapter {
  readonly writes: Array<Write & { definition?: ProviderMcpDefinition }> = []
  servers: ProviderMcpConfigServer[] = [
    {
      auth: 'unknown',
      error: null,
      file: '/home/dev/.claude.json',
      name: 'linear',
      origin: 'https://mcp.linear.app',
      scope: 'user',
      source: 'user',
      status: 'connected',
      tools: ['list_issues'],
      transport: 'http',
    },
    {
      auth: 'unknown',
      error: null,
      file: null,
      name: 'github',
      origin: null,
      scope: null,
      source: 'plugin',
      status: 'connected',
      tools: [],
      transport: 'stdio',
    },
  ]
  listed = 0

  readonly mcpConfig = {
    scopes: ['user', 'local', 'project'] as ProviderMcpScope[],
    list: async () => {
      this.listed += 1
      return this.servers
    },
    add: async (input: Write & { definition: ProviderMcpDefinition }) => {
      this.writes.push(input)
      this.servers = this.servers.concat([
        { ...this.servers[0]!, name: input.name, origin: null, tools: [], transport: 'stdio' },
      ])
    },
    remove: async (input: Write) => {
      this.writes.push(input)
      this.servers = this.servers.filter((server) => server.name !== input.name)
    },
    read: async (): Promise<ProviderMcpDefinition> => ({
      transport: 'stdio',
      command: 'x',
      args: [],
      env: {},
    }),
  }

  constructor() {
    super({
      displayLabel: 'Claude',
      driverKind: v.parse(providerDriverKindSchema, 'claude'),
      providerInstanceId: v.parse(providerInstanceIdSchema, 'claude'),
    })
  }
}

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
