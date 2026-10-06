import { minimapProofState } from './input-worker-proof.mjs'

export function admittedDormantMinimap(readiness, receipt) {
  const observed = mappedMinimapState(readiness, receipt)
  return Boolean(observed && observed.visible === false && observed.state.dormant)
}

function mappedMinimapState(readiness, receipt) {
  const match = /^view-(\d+)$/.exec(receipt.viewId ?? '')
  if (receipt.protocol !== 'canonical' || !match) return null
  const index = Number(match[1])
  const visible = readiness.views[index]?.visible
  if (typeof visible !== 'boolean') return null
  const worker = readiness.workers.find(
    (worker) =>
      worker.minimap === true && worker.terminated === false && worker.viewId === receipt.viewId,
  )
  if (!worker) return null
  const state = minimapProofState(worker, readiness.workers, visible)
  return state.protocol === 'canonical' ? { state, visible } : null
}

export function consumerSourcesCurrent(readiness, pendingMinimapSource = false) {
  if (!readiness) return true
  if ((readiness.tree?.pendingRequests ?? 0) !== 0 || (readiness.shiki?.pendingRequests ?? 0) !== 0)
    return false
  if (
    readiness.workers.some(
      (worker) =>
        !worker.terminated &&
        (worker.pendingSourceRequests !== 0 ||
          worker.pendingWorkerRequests !== 0 ||
          worker.pendingRenderRequests !== 0 ||
          worker.failedResponses !== 0 ||
          worker.staleResponses !== 0),
    )
  )
    return false
  return (
    readiness.sessions.every((session) => session.current && session.answered) &&
    readiness.minimaps.every((receipt) => {
      if (receipt.dormant) return admittedDormantMinimap(readiness, receipt)
      if (
        receipt.protocol === 'canonical' &&
        !mappedMinimapState(readiness, receipt)?.state.renderedAfterSource
      )
        return false
      return (
        (receipt.current || (pendingMinimapSource && receipt.protocol !== 'canonical')) &&
        receipt.renderedAfterSource
      )
    })
  )
}
