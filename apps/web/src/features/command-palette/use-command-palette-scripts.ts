import { filesystemPath } from '@/lib/documents/utils/identity'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useQuery } from '@tanstack/react-query'

import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import {
  packageJsonScripts,
  packageScriptRunner,
  projectScriptSuggestions,
  type ProjectScriptSuggestion,
} from '@/features/chat-mode/utils/project-scripts'
import { fetchFile, fetchTree } from '@/lib/file-server'

const NO_SCRIPTS: readonly ProjectScriptSuggestion[] = []

/**
 * The scripts this workspace can run: whatever the project saved, plus whatever
 * its `package.json` offers.
 *
 * Discovery is a client read of two files the workspace already serves rather
 * than a server route of its own — there is nothing here a `fs.read` does not
 * already answer, and a route would be a second way to ask the same question.
 *
 * Only fetched while the palette is in script mode. A manifest read on every
 * palette open would be two requests for a list most openings never show.
 */
export function useCommandPaletteScripts({
  enabled,
  rootPath,
}: {
  readonly enabled: boolean
  readonly rootPath: string | null
}) {
  const slice = useActiveChatProjection((state) => state)
  const worktree = rootPath !== null ? selectWorktreeAtPath(slice, rootPath) : undefined
  const saved = worktree
    ? (slice.projectById[worktree.projectId]?.scripts ?? NO_SCRIPTS)
    : NO_SCRIPTS
  const { data: discovered } = useQuery({
    enabled: enabled && rootPath !== null,
    queryFn: ({ signal, client }) =>
      discoverPackageScripts(rootPath ?? '', signal, clientForQueryClient(client)),
    queryKey: ['command-palette', 'scripts', rootPath ?? ''],
    // A project without a manifest answers the same way every time; retrying is
    // two more failed reads for the same empty list.
    retry: false,
    staleTime: 30_000,
  })

  return projectScriptSuggestions({ discovered: discovered ?? NO_SCRIPTS, saved })
}

async function discoverPackageScripts(rootPath: string, signal: AbortSignal, client: Client) {
  const tree = await fetchTree(filesystemPath(rootPath), signal, client).catch(() => null)
  if (!tree) return NO_SCRIPTS

  const names = tree.entries.map((entry) => entry.name)
  if (!names.includes('package.json')) return NO_SCRIPTS

  const manifest = await fetchFile(
    filesystemPath(rootPath ? `${rootPath}/package.json` : 'package.json'),
    signal,
    client,
  ).catch(() => null)
  if (!manifest) return NO_SCRIPTS

  return packageJsonScripts(manifest.content, packageScriptRunner(names))
}
