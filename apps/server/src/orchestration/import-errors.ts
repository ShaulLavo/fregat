import { defineErrorCatalog } from 'evlog'

export const sessionImportErrors = defineErrorCatalog('session-import', {
  UNAVAILABLE: {
    status: 503,
    message: 'Session import is unavailable on this machine',
    why: 'Import requires an enabled provider with local history support and a registered project.',
    fix: 'Enable Claude Code or Codex in Providers and add a project before importing.',
  },
  CONTINUED: {
    status: 409,
    message: 'This chat has already been continued in Platform',
    why: 'External history updates stop after the first Platform turn to prevent duplicate messages.',
    fix: 'Continue using the history saved in Platform.',
  },
})
