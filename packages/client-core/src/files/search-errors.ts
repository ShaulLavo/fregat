import { defineErrorCatalog } from 'evlog'

export const clientErrors = defineErrorCatalog('client', {
  EDEN_STREAM_MISSING: {
    status: 502,
    message: ({ label }: { label: string }) => `${label} response did not include a stream.`,
    why: 'The RPC call succeeded without the SSE body required by the caller.',
    fix: 'Verify the server route returns an event stream for this request.',
  },
  SEARCH_EVENT_ERROR: {
    status: 502,
    message: ({ message }: { message: string }) => message,
    why: 'The server emitted an error event while streaming search results.',
    fix: 'Adjust the search query or retry after the server search worker recovers.',
  },
  SEARCH_FAILED: {
    status: 502,
    message: ({ status }: { status: number | string }) => `Search failed with status ${status}.`,
    why: 'The search endpoint returned an error response.',
    fix: 'Retry the search or inspect server logs for the failing search request.',
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
