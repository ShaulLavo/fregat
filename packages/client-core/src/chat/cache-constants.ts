export const CHAT_MESSAGE_CACHE_LIMIT = 2_000
export const CHAT_CHECKPOINT_CACHE_LIMIT = 500
export const CHAT_PROPOSED_PLAN_CACHE_LIMIT = 200
export const CHAT_ACTIVITY_CACHE_LIMIT = 500

export const SESSION_DETAIL_SUBSCRIPTION_IDLE_EVICTION_MS = 15 * 60 * 1000
export const MAX_CACHED_SESSION_DETAIL_SUBSCRIPTIONS = 32
export const SIDEBAR_SESSION_DETAIL_PREWARM_LIMIT = 10

/**
 * Ceilings for the projection snapshot that paints the shell before the socket
 * connects. localStorage is a ~5 MB budget shared with drafts and workspace
 * state, and only the visible head of a transcript is worth a byte of it: the
 * detail stream replaces the whole slice the moment it lands.
 */
export const CHAT_PROJECTION_CACHE_SESSION_LIMIT = 200
export const CHAT_PROJECTION_CACHE_TRANSCRIPT_LIMIT = 3
export const CHAT_PROJECTION_CACHE_MESSAGE_LIMIT = 40
export const CHAT_PROJECTION_CACHE_ACTIVITY_LIMIT = 40
/** Throttle, not debounce: a streaming turn mutates faster than any debounce window. */
export const CHAT_PROJECTION_CACHE_PERSIST_MS = 500
