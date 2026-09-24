import { scopedSessionKey } from '@workspace/contracts'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

import {
  useSessionRailStore,
  type SessionRenameSurface,
} from '@/features/chat-mode/state/session-rail-store'

/** True while `surface` is the place renaming this session, so only it swaps for a field. */
export function useSessionRenaming(
  session: SessionRailItem | null,
  surface: SessionRenameSurface,
): boolean {
  const renaming = useSessionRailStore((state) => state.renaming)
  if (!session || renaming?.surface !== surface) return false

  return scopedSessionKey(renaming.ref) === session.key
}
