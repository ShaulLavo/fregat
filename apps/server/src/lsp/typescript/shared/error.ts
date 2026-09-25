import { isRecord } from '@workspace/utils/objects'

export const JSON_RPC_INTERNAL_ERROR = -32603

export type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

function isJsonRpcError(error: unknown): error is JsonRpcError {
  if (!isRecord(error)) return false
  return typeof error.code === 'number' && typeof error.message === 'string'
}

// Keeps its own fallback: contracts' `errorMessage` would answer JSON-RPC with `[object Object]`.
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'TypeScript LSP operation failed'
}

export function toResponseError(error: unknown): JsonRpcError {
  if (isJsonRpcError(error)) return error
  return { code: JSON_RPC_INTERNAL_ERROR, message: errorMessage(error) }
}
