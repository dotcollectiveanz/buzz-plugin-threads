/**
 * Shared constants for the Threads plugin.
 *
 * Source of truth for these values is the approved scope, section 5/6.
 */

/** Sidebar shows at most this many thread rows. */
export const MAX_ROWS = 20;

/** Threads with no activity for this many days are hidden. */
export const STALE_DAYS = 14;

/** Replies shown on a thread card before "Show N more replies". */
export const PREVIEW_REPLIES = 3;

/** Debounce for recomputing the thread index from live input, in milliseconds. */
export const DEBOUNCE_MS = 150;

export const SECONDS_PER_DAY = 24 * 60 * 60;
