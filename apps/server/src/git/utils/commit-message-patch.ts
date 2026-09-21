type PatchFile = {
  path: string
  patch: string
}

// Codex rejects input over 1,048,576 characters; a subject line needs far less.
const COMMIT_MESSAGE_PATCH_BUDGET = 200_000

const TRUNCATION_MARKER = '[patch truncated]'
const SEPARATOR = '\n\n'

/** Every path survives; patch bodies share the budget, smallest files first. */
export function budgetCommitMessagePatch(
  files: readonly PatchFile[],
  budget = COMMIT_MESSAGE_PATCH_BUDGET,
) {
  const patches = files.map((file) => file.patch.trimEnd())
  const total = patches.reduce((sum, patch) => sum + patch.length, 0)
  if (total <= budget) return patches.join(SEPARATOR)

  const header = [`Changed files (${files.length}):`, ...files.map((file) => file.path), ''].join(
    '\n',
  )
  const separators = SEPARATOR.length * files.length
  const allowances = patchAllowances(patches, Math.max(0, budget - header.length - separators))
  const bodies = patches.map((patch, position) => clipPatch(patch, allowances[position] ?? 0))

  return [header, bodies.filter(Boolean).join(SEPARATOR)].join('\n')
}

function patchAllowances(patches: readonly string[], budget: number) {
  const order = patches.map((_, position) => position)
  order.sort((left, right) => (patches[left]?.length ?? 0) - (patches[right]?.length ?? 0))

  const allowances = Array.from(patches, () => 0)
  let remaining = budget
  for (const [rank, position] of order.entries()) {
    const share = Math.floor(remaining / (order.length - rank))
    const allowance = Math.min(patches[position]?.length ?? 0, share)
    allowances[position] = allowance
    remaining -= allowance
  }

  return allowances
}

function clipPatch(patch: string, allowance: number) {
  if (patch.length <= allowance) return patch
  if (allowance <= TRUNCATION_MARKER.length) return ''

  return `${patch.slice(0, allowance - TRUNCATION_MARKER.length - 1)}\n${TRUNCATION_MARKER}`
}
