import type { GitForge, GitForgeKind } from '@workspace/contracts'
import { azureDevOps } from './azure-devops'
import { bitbucket } from './bitbucket'
import { forgeCommand } from './cli'
import { detectForge, remoteHost, remoteRepositoryPath } from './detect'
import { forgejo } from './forgejo'
import { github } from './github'
import { gitlab } from './gitlab'
import type { ForgeContext, ForgeProvider, RunProcess } from './types'

const PROVIDERS: Record<GitForgeKind, ForgeProvider> = {
  github,
  gitlab,
  forgejo,
  'azure-devops': azureDevOps,
  bitbucket,
}

/**
 * Where a checkout's remote points changes when someone adds a remote or signs a CLI in, not
 * between two renders; a minute keeps the git and CLI probes off every poll.
 */
const CONTEXT_CACHE_TTL_MS = 60_000

const contexts = new Map<string, { at: number; context: ForgeContext | null }>()

export function forgeProvider(kind: GitForgeKind) {
  return PROVIDERS[kind]
}

/**
 * The forge for a checkout: `origin` first, then the first remote with a known host, then the
 * first remote. An unknown host is still a self-hosted GitLab or Forgejo when its CLI has a login
 * for it. Upstream `SourceControlProviderRegistry.selectProviderContext`.
 */
export async function resolveForgeContext(input: {
  cwd: string
  run: RunProcess
  fetch: typeof fetch
}): Promise<ForgeContext | null> {
  const cached = contexts.get(input.cwd)
  if (cached && Date.now() - cached.at < CONTEXT_CACHE_TTL_MS) return cached.context
  const context = await selectContext(input)
  contexts.set(input.cwd, { at: Date.now(), context })
  return context
}

async function selectContext(input: { cwd: string; run: RunProcess; fetch: typeof fetch }) {
  const remotes = await listRemotes(input)
  const candidates = remotes.map((remote) => ({ ...remote, forge: detectForge(remote.url) }))
  const chosen =
    candidates.find((remote) => remote.name === 'origin') ??
    candidates.find((remote) => remote.forge !== null) ??
    candidates[0]
  if (!chosen) return null
  const forge = chosen.forge ?? (await refineUnknownForge(input, chosen.url))
  // Bitbucket Data Center speaks a different API than Bitbucket Cloud's 2.0.
  if (!forge || (forge.kind === 'bitbucket' && forge.host !== 'bitbucket.org')) return null
  return {
    cwd: input.cwd,
    forge,
    remoteUrl: chosen.url,
    remoteName: chosen.name,
    repository: remoteRepositoryPath(chosen.url),
    run: input.run,
    fetch: input.fetch,
  } satisfies ForgeContext
}

async function listRemotes(input: { cwd: string; run: RunProcess }) {
  const probe = { cwd: input.cwd, run: input.run, forge: GIT_PROBE }
  const result = await forgeCommand(probe, ['git', '-C', input.cwd, 'remote', '-v'])
  if (result.exitCode !== 0) return []
  const remotes = new Map<string, string>()
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim())
    if (match?.[1] && match[2] && !remotes.has(match[1])) remotes.set(match[1], match[2])
  }
  return [...remotes].map(([name, url]) => ({ name, url }))
}

/** A self-hosted instance on a host whose name says nothing, recognised by a signed-in CLI. */
async function refineUnknownForge(
  input: { cwd: string; run: RunProcess },
  remoteUrl: string,
): Promise<GitForge | null> {
  const host = remoteHost(remoteUrl)
  if (!host) return null
  const probe = { cwd: input.cwd, run: input.run, forge: GIT_PROBE }
  const glab = await forgeCommand(probe, ['glab', 'auth', 'status', '--hostname', host])
  if (glab.exitCode === 0) return { kind: 'gitlab', name: 'GitLab Self-Hosted', host }
  const tea = await forgeCommand(probe, ['tea', 'login', 'list', '--output', 'json'])
  if (tea.exitCode === 0 && teaHosts(tea.stdout).includes(host))
    return { kind: 'forgejo', name: 'Forgejo', host }
  return null
}

function teaHosts(stdout: string) {
  try {
    const logins: unknown = JSON.parse(stdout)
    if (!Array.isArray(logins)) return []
    return logins.flatMap((login) => {
      const url = typeof login?.url === 'string' ? login.url : null
      const host = url ? remoteHost(url) : null
      return host ? [host] : []
    })
  } catch {
    return []
  }
}

/** Errors from the probes themselves name no forge yet. */
const GIT_PROBE = { name: 'Git' }
