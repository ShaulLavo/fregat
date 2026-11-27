import { prepareFileTreeInput, type PreparedFileTreeInput } from '@shaulavo/workbench-tree'

const preparedInputByPaths = new WeakMap<readonly string[], PreparedFileTreeInput>()

export function preparedTreeInputForPaths(paths: readonly string[]): PreparedFileTreeInput {
  const cached = preparedInputByPaths.get(paths)
  if (cached) return cached

  const preparedInput = prepareFileTreeInput(paths)
  preparedInputByPaths.set(paths, preparedInput)
  return preparedInput
}
