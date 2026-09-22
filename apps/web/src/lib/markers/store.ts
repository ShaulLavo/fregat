import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'
import type { LanguageServerDiagnosticSummary } from '@singapore-editor/lsp-plugin/websocket'

import { documentUriToFileName } from '@singapore-editor/lsp-plugin/paths'

type Marker = LanguageServerDiagnosticSummary['diagnostics'][number]

export type MarkerResource = {
  readonly uri: string
  readonly path: string
  readonly summary: LanguageServerDiagnosticSummary
}

export type MarkerStore = {
  /**
   * Replace every marker this owner holds for this resource. An empty list deletes the
   * pair — the protocol republishes a file's whole set, so a merge would strand fixed
   * diagnostics forever.
   */
  changeOne: (owner: string, uri: string, markers: readonly Marker[]) => void
  /** Retire everything an owner published, for a server that stopped or failed. */
  removeOwner: (owner: string) => void
  clear: () => void
  /** Worst severity first, then path, so the file most worth opening leads. */
  resources: () => readonly MarkerResource[]
  forUri: (uri: string) => LanguageServerDiagnosticSummary | null
  total: () => number
  subscribe: (listener: () => void) => () => void
}

export function createMarkerStore(): MarkerStore {
  const byResource = new Map<string, Map<string, readonly Marker[]>>()
  const byOwner = new Map<string, Set<string>>()
  const listeners = new Set<() => void>()
  let resources: readonly MarkerResource[] | null = null

  function publish() {
    resources = null
    for (const listener of listeners) listener()
  }

  function detach(owner: string, uri: string) {
    const owners = byResource.get(uri)
    if (owners?.delete(owner) && owners.size === 0) byResource.delete(uri)
    const uris = byOwner.get(owner)
    if (uris?.delete(uri) && uris.size === 0) byOwner.delete(owner)
  }

  function build(): readonly MarkerResource[] {
    const built = [...byResource.entries()].flatMap(([uri, owners]) => {
      const markers = [...owners.values()].flat()
      if (markers.length === 0) return []
      const path = documentUriToFileName(uri)?.replace(/^\/+/, '') ?? uri
      return [{ uri, path, summary: summarizeDiagnostics(uri, null, markers) }]
    })
    return built.toSorted(
      (left, right) =>
        worstSeverity(left.summary) - worstSeverity(right.summary) ||
        left.path.localeCompare(right.path),
    )
  }

  return {
    changeOne: (owner, uri, markers) => {
      if (markers.length === 0) {
        if (!byResource.get(uri)?.has(owner)) return
        detach(owner, uri)
        publish()
        return
      }
      const owners = byResource.get(uri) ?? new Map<string, readonly Marker[]>()
      owners.set(owner, [...markers])
      byResource.set(uri, owners)
      const uris = byOwner.get(owner) ?? new Set<string>()
      uris.add(uri)
      byOwner.set(owner, uris)
      publish()
    },
    removeOwner: (owner) => {
      const uris = byOwner.get(owner)
      if (!uris || uris.size === 0) return
      for (const uri of [...uris]) detach(owner, uri)
      publish()
    },
    clear: () => {
      if (byResource.size === 0 && byOwner.size === 0) return
      byResource.clear()
      byOwner.clear()
      publish()
    },
    resources: () => {
      resources ??= build()
      return resources
    },
    forUri: (uri) => {
      const owners = byResource.get(uri)
      if (!owners) return null
      const markers = [...owners.values()].flat()
      return markers.length > 0 ? summarizeDiagnostics(uri, null, markers) : null
    },
    total: () => {
      let total = 0
      for (const owners of byResource.values()) {
        for (const markers of owners.values()) total += markers.length
      }
      return total
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function worstSeverity(summary: LanguageServerDiagnosticSummary) {
  const { counts } = summary
  if (counts.error > 0) return 1
  if (counts.warning > 0) return 2
  if (counts.information > 0) return 3
  return 4
}

/** One store for the app, the way VS Code keeps one marker service. */
export const markerStore = createMarkerStore()
