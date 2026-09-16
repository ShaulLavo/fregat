import type { GitBaseRefChoice } from '@workspace/contracts'

/**
 * The names a repository is assumed to have branched from when nothing else
 * says otherwise. Order matters: `main` is checked before `master` so a
 * repository carrying both compares against the one it actually develops on.
 */
const DEFAULT_BASE_BRANCH_CANDIDATES = ['main', 'master'] as const

export type BaseRefCandidateInput = {
  /** The remote's own default branch, from `<remote>/HEAD`. */
  defaultBranch: string | null
  headBranch: string | null
  remoteNames: readonly string[]
}

/**
 * The ordered branch names a branch diff should try as its base, most specific
 * first. Names are normalized to their local form so the caller can probe the
 * remote-tracking ref and the local branch for each one in turn.
 */
export function baseRefCandidates(input: BaseRefCandidateInput): string[] {
  const candidates: string[] = []

  for (const candidate of [input.defaultBranch, ...DEFAULT_BASE_BRANCH_CANDIDATES]) {
    const normalized = stripRemotePrefix(candidate, input.remoteNames)
    if (!normalized) continue
    // A branch is never its own base, and repeating a candidate only repeats
    // the two `rev-parse` probes it costs.
    if (normalized === input.headBranch) continue
    if (candidates.includes(normalized)) continue

    candidates.push(normalized)
  }

  return candidates
}

/**
 * Pairs each local branch with the remote-tracking ref of the same name so a
 * picker shows one row per branch. Remotes with no local counterpart stay
 * available as choices of their own — a base often exists only on the remote.
 */
export function buildBaseRefChoices(
  localBranches: readonly string[],
  remoteBranches: readonly string[],
  remoteNames: readonly string[],
): GitBaseRefChoice[] {
  const unpaired = new Set(remoteBranches)
  const choices: GitBaseRefChoice[] = localBranches.map((local) => ({
    id: `local:${local}`,
    label: local,
    local,
    remote: matchRemoteBranch(local, unpaired, remoteNames),
  }))

  for (const remote of remoteBranches) {
    if (!unpaired.has(remote)) continue

    choices.push({ id: `remote:${remote}`, label: remote, local: null, remote })
  }

  return choices
}

/** The choice whose local or remote side is `ref`, by choice id. */
export function baseRefChoiceId(choices: readonly GitBaseRefChoice[], ref: string | null) {
  if (!ref) return null

  const choice = choices.find((candidate) => candidate.local === ref || candidate.remote === ref)

  return choice?.id ?? null
}

/** `origin/main` -> `main`, for any configured remote name. */
function stripRemotePrefix(ref: string | null, remoteNames: readonly string[]) {
  if (!ref) return null

  // Longest first: a repository with remotes `up` and `upstream` must not have
  // `upstream/main` shortened to `stream/main`.
  for (const remote of remoteNames.toSorted((left, right) => right.length - left.length)) {
    const prefix = `${remote}/`
    if (ref.startsWith(prefix)) return ref.slice(prefix.length) || null
  }

  return ref
}

function matchRemoteBranch(
  local: string,
  unpaired: Set<string>,
  remoteNames: readonly string[],
): string | null {
  const matches = [...unpaired].filter((remote) => stripRemotePrefix(remote, remoteNames) === local)
  const preferred = matches.find((remote) => remote.startsWith('origin/')) ?? matches[0]
  if (!preferred) return null

  unpaired.delete(preferred)

  return preferred
}
