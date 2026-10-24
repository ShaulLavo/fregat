export function stressSeeds(
  count: number,
  shard = process.env.COLLAB_STRESS === '1' ? process.env.COLLAB_STRESS_SHARD : undefined,
): number[] {
  if (!shard) return Array.from({ length: count }, (_, seed) => seed)
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard)
  if (!match) throw new TypeError('Stress shard must be index/count with a one-based index')
  const index = Number(match[1]),
    shards = Number(match[2])
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(shards) || index > shards)
    throw new TypeError('Stress shard index must be within its shard count')
  const from = Math.floor((count * (index - 1)) / shards)
  const to = Math.floor((count * index) / shards)
  return Array.from({ length: to - from }, (_, seed) => from + seed)
}
