import type { GitForge } from '@workspace/contracts'

/**
 * The forge a remote URL names, by host, in upstream's precedence: Forgejo (codeberg.org or a
 * `forgejo`/`gitea` label) before GitHub, GitLab, Azure DevOps and Bitbucket. Null for any other
 * host; `refineUnknownForge` may still recognise a self-hosted one from a signed-in CLI.
 * Ported from upstream `detectSourceControlProviderFromRemoteUrl`.
 */
export function detectForge(remoteUrl: string): GitForge | null {
  const host = remoteHost(remoteUrl)
  if (!host) return null
  const labels = host.split('.')
  if (host === 'codeberg.org' || labels.includes('forgejo') || labels.includes('gitea'))
    return { kind: 'forgejo', name: 'Forgejo', host }
  if (host === 'github.com' || labels.includes('github'))
    return { kind: 'github', name: host === 'github.com' ? 'GitHub' : 'GitHub Self-Hosted', host }
  if (host === 'gitlab.com' || labels.includes('gitlab'))
    return { kind: 'gitlab', name: host === 'gitlab.com' ? 'GitLab' : 'GitLab Self-Hosted', host }
  if (
    host === 'dev.azure.com' ||
    host.endsWith('.dev.azure.com') ||
    host.endsWith('.visualstudio.com')
  )
    return { kind: 'azure-devops', name: 'Azure DevOps', host }
  if (host === 'bitbucket.org' || labels.includes('bitbucket'))
    return {
      kind: 'bitbucket',
      name: host === 'bitbucket.org' ? 'Bitbucket' : 'Bitbucket Self-Hosted',
      host,
    }
  return null
}

/** Lowercased host without port, from an SCP-style (`git@host:path`) or URL remote. */
export function remoteHost(remoteUrl: string) {
  const scp = /^[a-zA-Z0-9._-]+@([^:/]+):/.exec(remoteUrl)
  if (scp?.[1]) return scp[1].toLowerCase()
  try {
    return new URL(remoteUrl).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** `owner/repo` (or `group/sub/project`) from a remote URL, without `.git`. */
export function remoteRepositoryPath(remoteUrl: string) {
  const scp = /^[a-zA-Z0-9._-]+@[^:/]+:(.+)$/.exec(remoteUrl)
  let pathname = scp?.[1] ?? null
  if (pathname === null) {
    try {
      pathname = new URL(remoteUrl).pathname
    } catch {
      return null
    }
  }
  const trimmed = pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  return trimmed.includes('/') ? trimmed : null
}
