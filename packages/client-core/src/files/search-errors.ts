import { defineErrorCatalog } from 'evlog'

export const searchErrors = defineErrorCatalog('search', {
  SEARCH_EVENT_ERROR: {
    status: 502,
    message: ({ message }: { message: string }) => message,
    why: 'The server emitted an error event while streaming search results.',
    fix: 'Adjust the search query or retry after the server search worker recovers.',
  },
  SEARCH_DONE_INVALID: {
    status: 502,
    message: 'Search response included an invalid completion event.',
    why: 'A `done` event payload was not an object, so its counts cannot be trusted.',
    fix: 'Check the server search event serializer.',
  },
  SEARCH_FAILED: {
    status: 502,
    message: ({ status }: { status: number | string }) => `Search failed with status ${status}.`,
    why: 'The search endpoint returned an error response.',
    fix: 'Retry the search or inspect server logs for the failing search request.',
  },
  SEARCH_INCOMPLETE: {
    status: 502,
    message: ({ matchCount }: { matchCount: number }) =>
      `Search stream ended after ${matchCount} matches without completing.`,
    why: 'The stream closed before a terminal `done` event, so the result set is partial.',
    fix: 'Retry the search; a partial result must not be treated as a complete one.',
  },
  SEARCH_MATCH_INVALID: {
    status: 502,
    message: 'Search response included an invalid match.',
    why: 'A search stream item did not match the expected workspace search schema.',
    fix: 'Check the server search event serializer.',
  },
  UNEXPECTED_SEARCH_EVENT: {
    status: 502,
    message: ({ event }: { event: string }) => `Unexpected search event: ${event}`,
    why: 'The search stream emitted an event type the client does not handle.',
    fix: 'Update the client event parser or stop emitting the unsupported event.',
  },
})
