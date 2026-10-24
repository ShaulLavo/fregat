import {
  isSustainedProductStream,
  reconcileProductionNetworkRequests,
  type ProductionNetworkRequest,
} from './production-cdp'

export function productionPayloadSummary(network: readonly ProductionNetworkRequest[] | null) {
  if (network === null) return null
  const reconciled = reconcileProductionNetworkRequests(network)
  return (['host', 'grammar', 'resolver', 'javascript', 'other'] as const).map((kind) => {
    const requests = reconciled.filter(
      (request) =>
        request.kind === kind &&
        request.resolvedByWorkerRequestId === null &&
        !isSustainedProductStream(request),
    )
    const missing = requests.filter(
      (request) =>
        request.transferredBytes === null ||
        request.failure !== null ||
        Boolean(request.transferReceiptError),
    )
    const observedDataReceived = requests.filter((request) => request.dataReceivedBytes !== null)
    return {
      kind,
      requests: requests.length,
      cacheHits: requests.filter((request) => request.fromCache).length,
      transferredBytes:
        missing.length > 0
          ? null
          : requests.reduce((sum, request) => sum + (request.transferredBytes ?? 0), 0),
      dataReceivedBytes:
        observedDataReceived.length === requests.length
          ? observedDataReceived.reduce((sum, request) => sum + (request.dataReceivedBytes ?? 0), 0)
          : null,
      dataReceivedRequestCount: observedDataReceived.length,
      incompleteRequests: missing.length,
    }
  })
}
