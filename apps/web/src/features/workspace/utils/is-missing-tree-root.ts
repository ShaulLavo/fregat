import { errorStringField } from '@workspace/contracts'

export function isMissingTreeRoot(error: unknown) {
  const code = errorStringField(error, 'code')
  return code === 'NOT_FOUND' || code === 'NOT_A_DIRECTORY' || code === 'INVALID_PATH'
}
