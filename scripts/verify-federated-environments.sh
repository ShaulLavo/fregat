#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if rg -n 'devSwitchOrigin|dev-origin-dialog' apps/web/src packages/client-core/src; then
  exit 1
fi

if rg -n 'connectMachine|disconnectMachine|onMachineState' apps/desktop/src/shared apps/desktop/src/preload; then
  exit 1
fi

(
  cd packages/contracts
  bun run test -- src/tests/machines.test.ts src/tests/settings-registry.test.ts src/tests/settings-mutations.test.ts src/tests/settings-schema.test.ts src/tests/settings-control.test.ts
  bun run typecheck
)
(
  cd apps/desktop
  bun --bun vitest run src/bun/tests/quit.test.ts
  bun run typecheck
  bun run lint
  bun run format:check
)
(
  cd apps/server
  bun --bun vitest run src/machines/tests src/installation/tests
  bun run typecheck
)
(
  cd apps/web
  bun --bun vitest run --project node --project dom \
    src/lib/environments/tests \
    src/state/tests/environment-connections.test.tsx \
    src/state/tests/environment-recovery.test.tsx \
    src/state/tests/ssh-recovery.test.tsx \
    src/features/environments/tests \
    src/features/settings/components/tests/machines-section.test.tsx \
    src/features/settings/tests/page.test.tsx \
    src/features/settings/tests/page-actions-ownership.test.tsx \
    src/features/settings/tests/environment-ownership.test.ts \
    src/features/chat-mode/components/tests/session-scope-menu.test.tsx \
    src/features/chat-mode/components/tests/session-rail.test.tsx \
    src/features/chat-mode/utils/tests/session-rail-model.test.ts \
    src/features/workspace/state/tests/cache.test.ts \
    src/features/chat/state/tests/chat-projection-cache.test.ts \
    src/features/chat/providers/tests/transport-provider.test.tsx \
    src/features/chat/components/tests/chat-view.test.tsx \
    src/features/chat/hooks/tests/use-chat-shell-subscription.test.tsx \
    src/features/git/tests/store-provider.test.tsx \
    src/features/git/hooks/tests/commit-draft.test.tsx \
    src/keymap/tests/command-provider.test.tsx \
    src/features/workbench/tests/editor-visible-snapshot.test.tsx \
    src/features/workbench/tests/wallpaper-query.test.ts \
    src/features/editor/tests/file-sync-service.test.ts \
    src/features/workbench/components/tests/editor-tab-bar.test.tsx \
    src/lib/tests/client-logging.test.ts
  bun run typecheck
  bun run lint
  bun run format:check
)
bun run settings:reference
bun run settings:schema:check
git diff --check
