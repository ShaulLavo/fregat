export function installInputWorkerProof(negative?: string | null): void
export function replayShikiSource(log: readonly unknown[]): string | null
export function replayTreeSitterSource(log: readonly unknown[]): string | null
export function replayMinimapLines(log: readonly unknown[]): {
  readonly lines: readonly { readonly text: string; readonly length: number }[]
  readonly textLength: number
} | null
export function minimapMatches(
  replayed: ReturnType<typeof replayMinimapLines>,
  text: string,
): boolean
export function replayCanonicalSource(canonical: unknown): string | null
export function canonicalSourcePoint(canonical: unknown): {
  readonly segment: string
  readonly revision: number
  readonly textVersion: number
} | null
export type InputWireIdentity = {
  readonly documentId: string
  readonly documentGeneration: number
  readonly endpointGeneration: number
  readonly registrationId: number
}
export type InputWirePoint = {
  readonly segment: string
  readonly revision: number
  readonly textVersion: number
}
export type InputPublicationPoint = {
  readonly segment: object
  readonly revision: number
  readonly textVersion: number
}
export function canonicalSourceIdentity(canonical: unknown): InputWireIdentity | null
export function createInputSourceIdentity(initialPoint: InputPublicationPoint): {
  matches(
    identity: InputWireIdentity | null | undefined,
    source: InputWirePoint | null | undefined,
    point: InputPublicationPoint,
  ): boolean
}
export type MinimapProofObservation = {
  readonly url: string
  readonly terminated: boolean
  readonly minimap: boolean
  readonly protocol?: string | null
  readonly viewId?: string | null
  readonly sourceUpdates: number
  readonly latestRender: number
  readonly acceptedRender: number
  readonly renderAfterSource: number
  readonly sourceAcknowledged?: boolean
  readonly renderSourceMatched?: boolean
  readonly acceptedSourceMatched?: boolean
  readonly pendingSourceRequests?: number
  readonly pendingWorkerRequests?: number
  readonly pendingRenderRequests?: number
  readonly failedResponses?: number
  readonly canceledRenders?: number
  readonly staleResponses?: number
  readonly sourceReceipt?: InputProjectionReceipt | null
  readonly requestedRenderSource?: InputProjectionReceipt | null
  readonly acceptedRenderSource?: InputProjectionReceipt | null
  readonly attestedRenderedSource?: InputProjectionReceipt | null
}
export type InputProjectionReceipt = {
  readonly kind: 'applied'
  readonly identity: InputWireIdentity
  readonly base: InputWirePoint | null
  readonly target: InputWirePoint
}
export function attestMinimapCurrentSource(worker: MinimapProofObservation): void
export function minimapProofState(
  worker: MinimapProofObservation,
  workers: readonly MinimapProofObservation[],
  visible: boolean | null,
): {
  readonly protocol: 'canonical' | 'legacy'
  readonly dormant: boolean
  readonly renderedAfterSource: boolean
}
export function minimapRenderAccepted(
  worker: MinimapProofObservation,
  workers: readonly MinimapProofObservation[],
  visible: boolean | null,
): boolean
