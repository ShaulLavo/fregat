export const inputConsumerIds = Object.freeze([
  'native',
  'disabled',
  'tree-sitter',
  'shiki',
  'minimap',
  'tree-sitter-shiki',
  'tree-sitter-minimap',
  'shiki-minimap',
  'all',
  'platform',
])

// Platform's large-file policy (editor.largeFile.* defaults): analysis consumers pause above
// 10 Mi UTF-16 code units and the minimap above 50 Mi, so those fixtures measure the paused set.
const miCodeUnits = 1_048_576
export const analysisLimitCodeUnits = 10 * miCodeUnits
export const minimapLimitCodeUnits = 50 * miCodeUnits

export function inputHasWorkerTreeSitter(id) {
  return id !== 'native' && inputConsumerConfiguration(id, 'ordinary', 1).treeSitter
}

export function inputConsumerConfiguration(id, fixture, length) {
  if (!inputConsumerIds.includes(id))
    throw new TypeError(`Unknown input consumer configuration: ${id}`)
  if (!Number.isInteger(length) || length < 0) throw new TypeError('Missing fixture length')
  const native = id === 'native'
  const platform = id === 'platform'
  const analysis = native || length <= analysisLimitCodeUnits
  return {
    id,
    analysis,
    treeSitter: native
      ? fixture === 'ordinary'
      : analysis && (id.includes('tree-sitter') || id === 'all' || platform),
    shiki: analysis && (id.includes('shiki') || id === 'all' || platform),
    minimap:
      length <= minimapLimitCodeUnits && (id.includes('minimap') || id === 'all' || platform),
    find: native || platform,
    platform,
    language: 'typescript',
    theme: 'github-dark',
  }
}
