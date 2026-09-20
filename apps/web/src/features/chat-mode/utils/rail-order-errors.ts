import { defineErrorCatalog } from 'evlog'
export const railOrderErrors = defineErrorCatalog('chatRail', {
  DROP_CHANGED: {
    status: 409,
    message: 'The session changed while it was being moved.',
    why: 'Canonical membership, shelf or order changed before this drop was confirmed.',
    fix: 'Use the current session location and try the move again.',
  },
})
