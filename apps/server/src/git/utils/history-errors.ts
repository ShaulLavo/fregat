import { defineErrorCatalog } from 'evlog'

export const historyErrors = defineErrorCatalog('git', {
  HISTORY_REF_MISSING: {
    status: 404,
    message: 'This history reference is no longer available',
    why: 'The selected branch or tag does not resolve to a local commit.',
    fix: 'Refresh the graph and choose an available branch or tag.',
  },
  HISTORY_OUTPUT_INVALID: {
    status: 500,
    message: 'Git returned unreadable history data',
    why: 'The history output did not match the expected commit or file record format.',
    fix: 'Check the Git request log and refresh the graph.',
  },
})
