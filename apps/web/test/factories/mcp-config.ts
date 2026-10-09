import { MockProviderAdapter } from 'server/testing'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  type ProviderMcpConfigServer,
  type ProviderMcpDefinition,
  type ProviderMcpScope,
} from '@workspace/contracts'
import * as v from 'valibot'

type Write = { folder: string; name: string; scope: ProviderMcpScope }

export class McpConfigAdapter extends MockProviderAdapter {
  readonly writes: Array<Write & { definition?: ProviderMcpDefinition }> = []
  readonly reads: Write[] = []
  readonly signIns: Array<{ folder: string; name: string }> = []
  readonly folders = new Map<string, ProviderMcpConfigServer[]>()
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
  readonly listFolders: string[] = []
  listed = 0
  private held: ReturnType<typeof Promise.withResolvers<void>> | null = null
  private entered = Promise.withResolvers<void>()

  readonly mcpConfig = {
    scopes: ['user', 'local', 'project'] satisfies ProviderMcpScope[],
    list: async ({ folder }: { folder: string }) => {
      this.listed += 1
      this.listFolders.push(folder)
      this.entered.resolve()
      await this.held?.promise
      return this.folders.get(folder) ?? this.servers
    },
    add: async (input: Write & { definition: ProviderMcpDefinition }) => {
      this.writes.push(input)
      const servers = this.folders.get(input.folder) ?? this.servers
      const next = servers.concat({
        ...servers[0]!,
        name: input.name,
        origin: null,
        tools: [],
        transport: 'stdio',
      })
      this.store(input.folder, next)
    },
    remove: async (input: Write) => {
      this.writes.push(input)
      const servers = this.folders.get(input.folder) ?? this.servers
      this.store(
        input.folder,
        servers.filter((server) => server.name !== input.name),
      )
    },
    read: async (input: Write): Promise<ProviderMcpDefinition> => {
      this.reads.push(input)
      return { transport: 'stdio', command: this.adapterKey, args: [], env: {} }
    },
    signIn: async (input: { folder: string; name: string }) => {
      this.signIns.push(input)
      const done = Promise.withResolvers<void>()
      return {
        authorizationUrl: `https://auth.example.test/${this.adapterKey}`,
        done: done.promise,
        finish: async () => done.resolve(),
        cancel: () => done.resolve(),
      }
    },
  }

  constructor({ id = 'claude', label = 'Claude', driver = 'claude' } = {}) {
    super({
      displayLabel: label,
      driverKind: v.parse(providerDriverKindSchema, driver),
      providerInstanceId: v.parse(providerInstanceIdSchema, id),
    })
  }

  holdLists() {
    this.held = Promise.withResolvers<void>()
    this.entered = Promise.withResolvers<void>()
    return {
      entered: this.entered.promise,
      release: () => {
        this.held?.resolve()
        this.held = null
      },
    }
  }

  private store(folder: string, servers: ProviderMcpConfigServer[]) {
    if (this.folders.has(folder)) this.folders.set(folder, servers)
    else this.servers = servers
  }
}
