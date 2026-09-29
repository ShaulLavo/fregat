import { defineErrorCatalog } from 'evlog'

export const historyErrors = defineErrorCatalog('git', {
  HISTORY_REF_MISSING: {
    status: 404,
    message: 'This branch or tag no longer exists',
    why: 'The selected branch or tag was deleted or renamed.',
    fix: 'Refresh the graph and choose an available branch or tag.',
  },
  HISTORY_OUTPUT_INVALID: {
    status: 500,
    message: 'Git returned unreadable history data',
    why: 'Git returned commit history in a form Platform cannot read.',
    fix: 'Check the Git request log and refresh the graph.',
  },
})
