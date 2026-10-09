export type CompilerProbeOwner = {
  readonly read: () => string
  readonly readSnapshot: (revision: number) => { readonly revision: number; readonly value: string }
}

export function useCompilerProbe(owner: CompilerProbeOwner, revision: number) {
  useDebugValue(revision)
  return { opaque: owner.read(), observed: owner.readSnapshot(revision) }
}
import { useDebugValue } from 'react'
