import { paletteQueryKeys } from '@/features/command-palette/utils/query-keys'
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
  t3ProjectScripts,
  type ProjectScriptSuggestion,
} from '@/features/chat-mode/utils/project-scripts'
import { fetchFile, fetchTree } from '@/lib/file-server'

const NO_SCRIPTS: readonly ProjectScriptSuggestion[] = []

/**
 * The scripts this workspace can run: whatever the project saved, plus whatever
 * its `t3.json` and `package.json` offer.
 *
 * Discovery is a client read of two files the workspace already serves rather
 * than a server route of its own — there is nothing here a `fs.read` does not
 * already answer, and a route would be a second way to ask the same question.
 *
 * Only fetched while the palette is in script mode. A manifest read on every
 * palette open would be two requests for a list most openings never show.
 */
export function useScripts({
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
  // isLoading, not isPending: a disabled query stays pending forever and would hold saved scripts behind a loader.
  const { data: discovered, isLoading } = useQuery({
    enabled: enabled && rootPath !== null,
    queryFn: ({ signal, client }) =>
      discoverScripts(rootPath ?? '', signal, clientForQueryClient(client)),
    queryKey: paletteQueryKeys.scripts(rootPath ?? ''),
    // A project without a manifest answers the same way every time; retrying is
    // two more failed reads for the same empty list.
    retry: false,
    staleTime: 30_000,
  })

  return {
    isPending: isLoading,
    scripts: projectScriptSuggestions({
      discovered: discovered?.manifest ?? NO_SCRIPTS,
      projectFile: discovered?.projectFile ?? NO_SCRIPTS,
      saved,
    }),
  }
}

const NO_DISCOVERY = { manifest: NO_SCRIPTS, projectFile: NO_SCRIPTS }

async function discoverScripts(rootPath: string, signal: AbortSignal, client: Client) {
  const tree = await fetchTree(filesystemPath(rootPath), signal, client).catch(() => null)
  if (!tree) return NO_DISCOVERY

  const names = tree.entries.map((entry) => entry.name)
  const read = (name: string) =>
    names.includes(name)
      ? fetchFile(filesystemPath(rootPath ? `${rootPath}/${name}` : name), signal, client).catch(
          () => null,
        )
      : Promise.resolve(null)
  const [manifest, projectFile] = await Promise.all([read('package.json'), read('t3.json')])

  return {
    manifest: manifest
      ? packageJsonScripts(manifest.content, packageScriptRunner(names))
      : NO_SCRIPTS,
    projectFile: projectFile ? t3ProjectScripts(projectFile.content) : NO_SCRIPTS,
  }
}
