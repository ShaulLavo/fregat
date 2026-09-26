/**
 * A pull request number from what a user pastes: a GitHub, GitLab, Forgejo or Azure DevOps URL,
 * `#123`, `123`, or a forge CLI checkout command. Null when it names none. Ported from upstream
 * `parsePullRequestReference`, returning the number every forge addresses a request by.
 */
export function parsePullRequestReference(input: string): number | null {
  const trimmed = checkoutArgument(input.trim()) ?? input.trim()
  if (!trimmed) return null
  for (const pattern of URL_PATTERNS) {
    const match = pattern.exec(trimmed)
    if (match?.[1]) return Number(match[1])
  }
  const number = /^#?(\d+)$/.exec(trimmed)?.[1]
  return number ? Number(number) : null
}

/**
 * The repository a pasted pull request URL belongs to, as lowercased host and path (`owner/repo`,
 * `group/sub/project`, `org/project/_git/repo`). Null for a bare number or checkout command.
 */
export function pullRequestReferenceRepository(input: string) {
  const trimmed = checkoutArgument(input.trim()) ?? input.trim()
  if (!URL_PATTERNS.some((pattern) => pattern.test(trimmed))) return null
  const url = new URL(trimmed)
  const path = url.pathname.split(REQUEST_SEGMENT)[0]?.replace(/^\/+/, '')
  if (!path) return null
  return { host: url.hostname.toLowerCase(), path: path.toLowerCase() }
}

const REQUEST_SEGMENT = /\/(?:pulls?|-\/merge_requests|pullrequest|pull-requests)\/\d+/i

const URL_PATTERNS = [
  /^https?:\/\/[^/\s]+\/(?:[^/\s]+\/)+[^/\s]+\/pulls\/(\d+)(?:[/?#].*)?$/i,
  /^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/(\d+)(?:[/?#].*)?$/i,
  /^https:\/\/[^/\s]+\/.+\/-\/merge_requests\/(\d+)(?:[/?#].*)?$/i,
  /^https:\/\/(?:dev\.azure\.com\/[^/\s]+\/[^/\s]+|[^/\s]+\.visualstudio\.com\/[^/\s]+)\/_git\/[^/\s]+\/pullrequest\/(\d+)(?:[/?#].*)?$/i,
  /^https:\/\/bitbucket\.org\/[^/\s]+\/[^/\s]+\/pull-requests\/(\d+)(?:[/?#].*)?$/i,
]

/** The reference inside `gh pr checkout …`, `glab mr checkout …`, `tea pr checkout …`, `az repos pr checkout --id …`. */
function checkoutArgument(input: string) {
  const cli = /^(?:gh\s+pr|glab\s+mr|tea\s+(?:pr|pulls))\s+checkout\s+(.+)$/i.exec(input)?.[1]
  if (cli) return cli.trim()
  const azure = /^az\s+repos\s+pr\s+checkout\s+(.+)$/i.exec(input)?.[1]
  if (!azure) return null
  const parts = azure.trim().split(/\s+/)
  const flag = parts.findIndex((part) => part === '--id' || part === '-i')
  if (flag >= 0) return parts[flag + 1] ?? null
  const inline = parts.find((part) => part.startsWith('--id='))
  if (inline) return inline.slice('--id='.length)
  return parts.find((part) => !part.startsWith('-')) ?? null
}
