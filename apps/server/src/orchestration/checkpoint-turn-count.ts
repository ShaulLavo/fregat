export function maxCheckpointTurnCount(
  checkpoints: readonly { readonly checkpointTurnCount: number }[],
) {
  let maxTurnCount = 0

  for (const checkpoint of checkpoints) {
    maxTurnCount = Math.max(maxTurnCount, checkpoint.checkpointTurnCount)
  }

  return maxTurnCount
}
