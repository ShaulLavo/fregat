import * as v from 'valibot'
import { runBoundedProcess } from '../git/utils/process'

type TitleSourceLink = { readonly kind: 'github' | 'gitlab'; readonly endpoint: string }
const subjectSchema = v.object({
  title: v.string(),
  body: v.optional(v.nullable(v.string())),
  description: v.optional(v.nullable(v.string())),
})

export function titleSourceLink(url: URL): TitleSourceLink | undefined {
  if (url.protocol !== 'https:' || url.username || url.password) return undefined
  if (url.host === 'github.com') {
    const match = /^\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/([1-9]\d*)(?:\/.*)?$/.exec(
      url.pathname,
    )
    if (!match) return undefined
    return { kind: 'github', endpoint: `repos/${match[1]}/${match[2]}/issues/${match[3]}` }
  }
  if (url.host !== 'gitlab.com') return undefined
  const match = /^\/(.+)\/-\/(merge_requests|issues)\/([1-9]\d*)(?:\/.*)?$/.exec(url.pathname)
  if (!match) return undefined
  return {
    kind: 'gitlab',
    endpoint: `projects/${encodeURIComponent(match[1]!)}/${match[2]}/${match[3]}`,
  }
}

export function sessionTitleLinks(message: string) {
  const links = new Map<string, TitleSourceLink>()
  for (const match of message.matchAll(/https:\/\/[^\s<>"')\]`]+/g)) {
    let url: URL
    try {
      url = new URL(match[0].replace(/[.,;!?]+$/, ''))
    } catch {
      continue
    }
    url.hash = ''
    url.search = ''
    if (links.has(url.href)) continue
    const source = titleSourceLink(url)
    if (!source) continue
    links.set(url.href, source)
    if (links.size === 2) break
  }
  return links
}

async function readSubject(
  url: string,
  source: TitleSourceLink,
  cwd: string,
  runProcess: typeof runBoundedProcess,
) {
  try {
    const github = source.kind === 'github'
    const result = await runProcess({
      cwd,
      argv: [
        github ? 'gh' : 'glab',
        'api',
        '--hostname',
        new URL(url).host,
        source.endpoint,
        ...(github ? ['--jq', '{title, body}'] : []),
      ],
      ...(github ? { env: { GH_PROMPT_DISABLED: '1' } } : {}),
      timeoutMs: 3_000,
      maxOutputBytes: 32_000,
    })
    if (result.exitCode !== 0 || result.limit) return `${url}: unavailable`
    const subject = v.parse(subjectSchema, JSON.parse(result.stdout))
    const body = github ? subject.body : subject.description
    return `${url}\n${JSON.stringify({ title: subject.title.slice(0, 300), body: body?.slice(0, 1_200) ?? '' })}`
  } catch {
    return `${url}: unavailable`
  }
}

export async function resolveSessionTitleLinks(
  input: { message: string; cwd: string; signal: AbortSignal },
  runProcess: typeof runBoundedProcess = runBoundedProcess,
) {
  input.signal.throwIfAborted()
  const links = sessionTitleLinks(input.message)
  const subjects = await Promise.all(
    [...links].map(([url, source]) => readSubject(url, source, input.cwd, runProcess)),
  )
  input.signal.throwIfAborted()
  return subjects.length ? subjects.join('\n\n') : undefined
}
