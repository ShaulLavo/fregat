import type { Host, SubmitResult } from '../src/host'
import type { Envelope } from '../src/types'

export function submitAsAuthor<Snapshot>(host: Host<Snapshot>, envelope: Envelope): SubmitResult {
  return host.submit(envelope, envelope.id.actor)
}
