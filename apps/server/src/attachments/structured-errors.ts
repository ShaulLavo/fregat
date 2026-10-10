import { defineErrorCatalog } from 'evlog'

export const attachmentErrors = defineErrorCatalog('attachments', {
  MACHINE_FILE_EMPTY: {
    status: 422,
    message: 'That file is empty',
    why: 'An attachment carries at least one byte.',
    fix: 'Choose a file with content.',
  },
  MACHINE_FILE_TOO_LARGE: {
    status: 413,
    message: 'That file is over 50 MB',
    why: 'Each attached file holds at most 50 MB.',
    fix: 'Choose a smaller file, or mention its path in the message so the agent reads it there.',
  },
  MACHINE_FILE_CHANGED: {
    status: 409,
    message: 'That file changed while it was being attached',
    why: 'The copied bytes no longer match the size the file had when it was chosen.',
    fix: 'Attach the file again once it stops changing.',
  },
})
