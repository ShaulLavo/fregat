export { applyObservability } from './elysia'

export { runDetached } from './detached'

export { observabilityRoutes } from './routes'
export { isEvlogError, lspErrors, orchestrationErrors, serverErrors } from './structured-errors'
export {
  flushObservability,
  initializeObservability,
  recordProcessError,
  recordProcessInfo,
  recordProcessWarning,
  setLogRetentionDays,
} from './runtime'
export {
  operatorErrorSummary,
  limitText,
  observeRequestOperation,
  recordClientInstance,
  recordGitCommand,
  recordRequestContext,
  recordRequestError,
  recordRequestWarning,
  recordStreamSummary,
  type OperationContext,
} from './logging'
