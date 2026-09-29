import { defineErrorCatalog } from 'evlog'

export const searchErrors = defineErrorCatalog('search', {
  SEARCH_EVENT_ERROR: {
    status: 502,
    message: ({ message }: { message: string }) => message,
    why: 'The server hit an error while searching.',
    fix: 'Change the search or try again.',
  },
  SEARCH_DONE_INVALID: {
    status: 502,
    message: 'The search finished with an answer the app could not read.',
    why: 'The server sent a malformed end-of-search message, so the result counts may be wrong.',
    fix: 'Run the search again.',
  },
  SEARCH_FAILED: {
    status: 502,
    message: ({ status }: { status: number | string }) => `Search failed with status ${status}.`,
    why: 'The server answered the search with an error.',
    fix: 'Try again. If it keeps failing, open the Logs panel to see what went wrong.',
  },
  SEARCH_INCOMPLETE: {
    status: 502,
    message: ({ matchCount }: { matchCount: number }) =>
      `Search stopped early after ${matchCount} matches.`,
    why: 'The connection closed before the search finished, so more matches may exist.',
    fix: 'Run the search again to see every match.',
  },
  SEARCH_MATCH_INVALID: {
    status: 502,
    message: 'The search returned a match the app could not read.',
    why: 'The server sent a malformed search result.',
    fix: 'Run the search again.',
  },
  UNEXPECTED_SEARCH_EVENT: {
    status: 502,
    message: ({ event }: { event: string }) => `Unexpected search event: ${event}`,
    why: 'The server sent a search update this version of the app does not know.',
    fix: 'Reload the app so it matches the server version.',
  },
})
