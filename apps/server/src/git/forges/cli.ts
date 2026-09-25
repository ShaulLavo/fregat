import { errorStringField } from '@workspace/contracts'
import * as v from 'valibot'
import { gitPullRequestErrors } from '../utils/pull-request-errors'
import type { ForgeContext } from './types'

/** Forge CLIs wait on a remote service; 20s covers a cold auth handshake. */
const FORGE_TIMEOUT_MS = 20_000

export type ForgeCommandResult = { exitCode: number; stdout: string; stderr: string }

/** What errors need: the service's display name. */
type Named = { readonly forge: { readonly name: string } }

/**
 * Runs a forge CLI through the bounded process wrapper. A binary that is not on PATH comes back
 * as exit 127 with empty output, which `cliSupport` reads as `cli-missing`.
 */
export async function forgeCommand(
  context: Pick<ForgeContext, 'cwd' | 'run'> & Named,
  argv: readonly string[],
  options: { env?: Readonly<Record<string, string>>; input?: string } = {},
): Promise<ForgeCommandResult> {
  let result: Awaited<ReturnType<ForgeContext['run']>>
  try {
    result = await context.run({
      argv,
      cwd: context.cwd,
      timeoutMs: FORGE_TIMEOUT_MS,
      ...(options.env ? { env: options.env } : {}),
      ...(options.input === undefined ? {} : { input: options.input }),
    })
  } catch (cause) {
    if (errorStringField(cause, 'code') === 'ENOENT')
      return { exitCode: 127, stderr: '', stdout: '' }
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
      forge: context.forge.name,
      cause: cause instanceof Error ? cause : undefined,
      internal: { at: 'spawn', command: argv[0], errorCode: errorStringField(cause, 'code') },
    })
  }
  if (result.limit?.kind === 'timeout')
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_TIMED_OUT({
      forge: context.forge.name,
      internal: { command: argv[0], ...result.limit },
    })
  if (result.limit)
    throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
      forge: context.forge.name,
      internal: { command: argv[0], ...result.limit },
    })
  return result
}

/** A lookup that did not exit 0 never becomes "no pull request". */
export function requireSuccess(context: Named, result: ForgeCommandResult, at: string) {
  if (result.exitCode === 0) return result
  throw gitPullRequestErrors.PULL_REQUEST_LOOKUP_FAILED({
    forge: context.forge.name,
    internal: {
      at,
      exitCode: result.exitCode,
      rateLimited: /rate limit|too many requests|http 429/i.test(result.stderr),
    },
  })
}

/** A create the forge refused; its stderr stays out of the error, which reaches the client. */
export function requireCreated(context: Named, branch: string, result: ForgeCommandResult) {
  if (result.exitCode === 0) return
  throw gitPullRequestErrors.PULL_REQUEST_CREATE_FAILED({
    branch,
    forge: context.forge.name,
    internal: { exitCode: result.exitCode },
  })
}

/** A repository the forge refused to create; the CLI's words stay in the log's internal fields. */
export function requireRepositoryCreated(
  context: Named & { readonly repository: string | null },
  result: ForgeCommandResult,
) {
  if (result.exitCode === 0) return result
  throw gitPullRequestErrors.REPOSITORY_CREATE_FAILED({
    forge: context.forge.name,
    repository: context.repository ?? '',
    internal: { exitCode: result.exitCode },
  })
}

/** The `/`-separated parts a forge addresses a repository by, or a named refusal. */
export function repositoryParts(
  context: Named & { readonly repository: string | null },
  count: number,
  expected: string,
) {
  const parts = (context.repository ?? '').split('/').filter(Boolean)
  if (parts.length === count) return parts
  throw gitPullRequestErrors.REPOSITORY_NAME_INVALID({
    forge: context.forge.name,
    expected,
    internal: { segments: parts.length },
  })
}

/** Missing binary, signed out, or ready, from a CLI's auth-status exit. */
export function cliSupport(result: ForgeCommandResult) {
  if (result.exitCode !== 0 && !result.stderr && !result.stdout) return 'cli-missing' as const
  if (result.exitCode !== 0) return 'unauthenticated' as const
  return 'ready' as const
}

export function parseForgeJson<TSchema extends v.GenericSchema>(
  context: Named,
  schema: TSchema,
  stdout: string,
  at: string,
): v.InferOutput<TSchema> {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch (cause) {
    throw gitPullRequestErrors.PULL_REQUEST_RESPONSE_INVALID({
      forge: context.forge.name,
      cause: cause instanceof Error ? cause : undefined,
      internal: { at: `${at}-json`, outputLength: stdout.length },
    })
  }
  const parsed = v.safeParse(schema, json)
  if (parsed.success) return parsed.output
  throw gitPullRequestErrors.PULL_REQUEST_RESPONSE_INVALID({
    forge: context.forge.name,
    internal: { at: `${at}-schema`, summary: v.summarize(parsed.issues) },
  })
}

/** Runs `lookup` per branch; forges without a batched query pay one request each. */
export async function perBranch<T>(
  branches: readonly string[],
  lookup: (branch: string) => Promise<T>,
): Promise<ReadonlyMap<string, T>> {
  const answers = new Map<string, T>()
  for (const branch of new Set(branches)) answers.set(branch, await lookup(branch))
  return answers
}
