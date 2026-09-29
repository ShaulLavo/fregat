import { defineErrorCatalog } from 'evlog'

export const sessionImportErrors = defineErrorCatalog('session-import', {
  UNAVAILABLE: {
    status: 503,
    message: 'Session import is unavailable on this machine',
    why: 'Importing needs a provider that saves chats on this machine, turned on, and a project to import into.',
    fix: 'Enable Claude Code or Codex in Providers and add a project before importing.',
  },
  CONTINUED: {
    status: 409,
    message: 'This chat has already been continued in Platform',
    why: 'Once a chat continues in Platform, it stops copying new messages from outside so none appear twice.',
    fix: 'Continue using the history saved in Platform.',
  },
})
