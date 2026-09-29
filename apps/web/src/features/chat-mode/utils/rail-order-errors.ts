import { defineErrorCatalog } from 'evlog'
export const railOrderErrors = defineErrorCatalog('chatRail', {
  DROP_CHANGED: {
    status: 409,
    message: 'The session changed while it was being moved.',
    why: 'The session list changed while you were dragging.',
    fix: 'Drag the session again.',
  },
})
