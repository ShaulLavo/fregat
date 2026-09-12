#!/usr/bin/env bash
set -euo pipefail

platform_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
editor_root=$(realpath "$platform_root/../Editor")

cd "$platform_root/apps/web"
bun run typecheck
bun --bun vitest run --project node \
  src/features/search/tests/search-replace-runner.test.ts \
  src/features/search/tests/search-buffer-state.test.ts \
  src/features/editor/tests/workspace-edit-service.test.ts \
  src/features/editor/tests/workspace-text-change.test.ts \
  src/features/editor/tests/workspace-edit-operation-event.test.ts \
  src/features/editor/tests/file-sync-service.test.ts \
  src/features/workspace/tests/conflict-editor-resolution.test.ts \
  src/features/workspace/tests/use-events.test.ts \
  src/lib/tests/file-server-ownership.test.ts \
  test/integration/workspace-edit.test.ts
bun --bun vitest run --project dom \
  src/features/search/tests/use-replace.test.tsx \
  src/features/editor/tests/workspace-edit-preview-dialog.test.tsx \
  src/features/terminal/hooks/tests/use-terminal-links.test.tsx \
  src/features/file-picker/tests/path-input-ownership.test.tsx \
  src/features/git/hooks/tests/environment-ownership.test.tsx

cd "$platform_root/apps/tui"
bun run typecheck
bun --bun vitest run src/search/tests/replacement.test.ts

cd "$platform_root/apps/server"
bun --bun vitest run src/fs/tests/write-event-ownership.test.ts src/fs/tests/watch.test.ts src/fs/tests/watch-classification.test.ts
bun --bun vitest run src/fs/tests/workspace-edit.test.ts -t 'rejects last-target drift after prepare'
bun --bun vitest run src/fs/tests/workspace-index.test.ts -t 'binds create acknowledgement'

cd "$editor_root/packages/lsp-plugin"
bun run test -- test/serverSet.test.ts test/codeActions.test.ts test/plugin.test.ts
bun run typecheck

cd "$platform_root"
git diff --check
