import { pushSessionPath, type SessionId, type WorktreeId } from '@workspace/contracts'
import type { FileSystemService } from '../fs/service'
import type { OrchestrationEngine } from '../orchestration/engine'

export type SessionLink = {
  /** Relative to the app base; empty opens the app where it was left. */
  readonly path: string
  readonly kind: 'session' | 'no-worktree' | 'outside-workspace'
}

/** The route that opens the session in its own worktree, as the tab would address it. */
export async function sessionLink(
  engine: Pick<OrchestrationEngine, 'readModelSnapshot'>,
  fs: Pick<FileSystemService, 'paths' | 'registerWorkspaceAddress'>,
  sessionId: SessionId,
  worktreeId: WorktreeId,
): Promise<SessionLink> {
  const worktree = (await engine.readModelSnapshot()).worktrees.get(worktreeId)
  if (!worktree || worktree.retiredAt) return { path: '', kind: 'no-worktree' }

  try {
    const relative = fs.paths.toRealRelative(worktree.canonicalPath)
    const address = await fs.registerWorkspaceAddress(relative)
    return { path: pushSessionPath(address, sessionId), kind: 'session' }
  } catch {
    // The worktree lies outside what this server serves, so no workspace address names it.
    return { path: '', kind: 'outside-workspace' }
  }
}
