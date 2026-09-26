import type { OrchestrationProjectScript } from '@workspace/contracts'

/** The project's setup script: the first saved script that runs on worktree creation. */
export function setupScript(scripts: readonly OrchestrationProjectScript[]) {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null
}
