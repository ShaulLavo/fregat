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

export function inputConsumerConfiguration(id, fixture) {
  if (!inputConsumerIds.includes(id))
    throw new TypeError(`Unknown input consumer configuration: ${id}`)
  const native = id === 'native'
  const platform = id === 'platform'
  return {
    id,
    treeSitter: native
      ? fixture === 'ordinary'
      : id.includes('tree-sitter') || id === 'all' || platform,
    shiki: id.includes('shiki') || id === 'all' || platform,
    minimap: id.includes('minimap') || id === 'all' || platform,
    find: native || platform,
    platform,
    language: 'typescript',
    theme: 'github-dark',
  }
}

export function assertConsumerReadiness(readiness, id, fixture, views, opened) {
  if (process.env.INPUT_CONSUMER_PROBE)
    console.log(
      JSON.stringify({
        event: 'input.consumers',
        id,
        fixture,
        views,
        after: Boolean(opened),
        readiness,
      }),
    )
}
