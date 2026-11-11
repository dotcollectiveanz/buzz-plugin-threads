/**
 * Thread index — the plugin's data layer. No React here.
 *
 * Scope section 6: a store with a stable `snapshot()` and `subscribe()` that
 * answers "which threads am I in" with an unread count per thread.
 *
 * Sources are ingested as events (live via `session.observe`, mirroring Inbox)
 * or as unread-projection items (`session.unread.inbox()`), plus pushed unread
 * counts from `session.unread.snapshot({ kind: "thread", ... })`.
 *
 * `snapshot()` returns a stable immutable array; a new reference is produced
 * only when the data actually changes.
 */

import { DEBOUNCE_MS, SECONDS_PER_DAY, STALE_DAYS } from "./constants";

export type ThreadReason = "started" | "replied" | "mentioned" | "followed";

export type ThreadEntry = {
  channelId: string;
  channelName: string;
  rootId: string;
  rootPreview: string;
  rootAuthor: string;
  /** Verified event seconds of the newest activity in the thread. */
  lastActivityAt: number;
  /** Observed distinct replies; `null` when unknown (never fabricated zero). */
  replyCount: number | null;
  /** From `session.unread`; `null` = unknown, never a fabricated zero. */
  unreadCount: number | null;
  reasons: readonly ThreadReason[];
};

/** A minimal structural view of a relay event; see `src/features/relay/events.ts`. */
export type RelayEventLike = {
  id: string;
  kind: number;
  /** Verified event seconds. */
  createdAt: number;
  authorId: string;
  content: string;
  tags: readonly (readonly string[])[];
};

/** A structural view of `InboxItem`; see `src/features/relay/inbox.ts`. */
export type InboxItemLike = {
  channelId: string;
  rootId?: string;
  messageId: string;
  authorId: string;
  preview: string;
  createdAt: number;
  mentioned: boolean;
  thread: boolean;
  unreadCount: number;
};

export type ThreadIndexOptions = {
  viewerId: string;
  /** Channel display name; `undefined` when the channel is unknown. */
  channelName: (channelId: string) => string | undefined;
  /** Defaults to "accessible". Dropped channels are excluded from the list. */
  channelAccessible?: (channelId: string) => boolean;
  /** Effective follow state; see `session.unread.following`. */
  isFollowing?: (channelId: string, rootId: string) => boolean;
  /** Current time in seconds. Defaults to `Math.floor(Date.now() / 1000)`. */
  now?: () => number;
  staleDays?: number;
  debounceMs?: number;
};

export type ThreadIndex = {
  /** Feed a relay event (viewer replies, viewer roots, mentions). */
  ingest(event: RelayEventLike): void;
  /** Feed an unread-projection item; closes the "replies to my posts" gap. */
  ingestInboxItem(item: InboxItemLike): void;
  /** Push the unread count for one thread target (`null` = unknown). */
  setUnreadCount(channelId: string, rootId: string, count: number | null): void;
  /** Signal that `isFollowing` / channel access / unread may have changed. */
  invalidate(): void;
  /** Stable immutable array; new reference only when data changes. */
  snapshot(): readonly ThreadEntry[];
  subscribe(listener: () => void): () => void;
  /** Recompute synchronously, cancelling any pending debounce (tests/wiring). */
  computeNow(): void;
  dispose(): void;
};

const CONTENT_KINDS = new Set([9, 40002, 40008]);
const REASON_ORDER: readonly ThreadReason[] = [
  "started",
  "replied",
  "mentioned",
  "followed",
];
const UNREAD_BOUND = 1000;

type RootRecord = {
  channelId: string;
  rootId: string;
  author: string;
  preview: string;
  lastActivityAt: number;
  rootAuthorIsViewer: boolean;
  viewerReplied: boolean;
  mentionedViewer: boolean;
  /** The unread projection surfaced this viewer-authored thread as active. */
  rootHasActivity: boolean;
  replyIds: Set<string>;
};

const keyOf = (channelId: string, rootId: string) => `${channelId}\u0000${rootId}`;

/**
 * The nav-entry badge: the number of listed threads that have unread replies.
 * A `null` (unknown) or zero count is not unread; if nothing is known unread
 * the result is `0`, which the caller renders as no badge.
 */
export function unreadThreadCount(entries: readonly ThreadEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.unreadCount !== null && entry.unreadCount > 0) count++;
  }
  return count;
}

function hTag(tags: RelayEventLike["tags"]): string | undefined {
  const values = tags
    .filter((tag) => tag[0] === "h" && typeof tag[1] === "string")
    .map((tag) => tag[1] as string);
  return values.length === 1 ? values[0] : undefined;
}

function mentionsViewer(
  tags: RelayEventLike["tags"],
  viewerId: string,
): boolean {
  return tags.some((tag) => tag[0] === "p" && tag[1] === viewerId);
}

/**
 * Resolve the canonical root of a reply from NIP-10 `e` tags.
 *
 * Buzz's own reply builder emits `["e", resolvedRootId, "", "reply"]`
 * (docs/relay-queries.md), so a `reply`-marked tag names the canonical root,
 * not the direct parent. A `root` marker wins; a lone untagged `e` is treated
 * as the legacy NIP-10 single-reference form. A self-reference is ignored.
 */
export function resolveThreadRoot(event: {
  id: string;
  tags: RelayEventLike["tags"];
}): string | undefined {
  const marked = { root: undefined as string | undefined, reply: undefined as string | undefined };
  const ids = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== "e") continue;
    const id = tag[1];
    if (typeof id !== "string" || !id || id === event.id) continue;
    ids.add(id);
    const marker = tag[3];
    if (marker === "root" && !marked.root) marked.root = id;
    else if (marker === "reply" && !marked.reply) marked.reply = id;
  }
  if (marked.root) return marked.root;
  if (marked.reply) return marked.reply;
  if (ids.size === 1) return [...ids][0];
  return undefined;
}

function previewOf(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 140);
}

function later(a: number, b: number): number {
  return a >= b ? a : b;
}

function sameEntries(
  a: readonly ThreadEntry[],
  b: readonly ThreadEntry[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.channelId !== y.channelId ||
      x.channelName !== y.channelName ||
      x.rootId !== y.rootId ||
      x.rootPreview !== y.rootPreview ||
      x.rootAuthor !== y.rootAuthor ||
      x.lastActivityAt !== y.lastActivityAt ||
      x.replyCount !== y.replyCount ||
      x.unreadCount !== y.unreadCount ||
      x.reasons.length !== y.reasons.length ||
      x.reasons.some((reason, index) => reason !== y.reasons[index])
    )
      return false;
  }
  return true;
}

export function createThreadIndex(options: ThreadIndexOptions): ThreadIndex {
  const viewerId = options.viewerId;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const staleSeconds =
    (options.staleDays ?? STALE_DAYS) * SECONDS_PER_DAY;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;

  const roots = new Map<string, RootRecord>();
  const unread = new Map<string, number | null>();
  const listeners = new Set<() => void>();
  let current: readonly ThreadEntry[] = Object.freeze([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let disposed = false;

  function rootRecord(
    channelId: string,
    rootId: string,
    at: number,
  ): RootRecord {
    const key = keyOf(channelId, rootId);
    let record = roots.get(key);
    if (!record) {
      record = {
        channelId,
        rootId,
        author: "",
        preview: "",
        lastActivityAt: at,
        rootAuthorIsViewer: false,
        viewerReplied: false,
        mentionedViewer: false,
        rootHasActivity: false,
        replyIds: new Set(),
      };
      roots.set(key, record);
    }
    return record;
  }

  function setUnreadCount(
    channelId: string,
    rootId: string,
    count: number | null,
  ) {
    const key = keyOf(channelId, rootId);
    unread.delete(key);
    unread.set(key, count);
    while (unread.size > UNREAD_BOUND) {
      const oldest = unread.keys().next().value;
      if (oldest === undefined) break;
      unread.delete(oldest);
    }
    schedule();
  }

  function ingest(event: RelayEventLike) {
    if (disposed || !CONTENT_KINDS.has(event.kind)) return;
    const channelId = hTag(event.tags);
    if (!channelId) return;
    const mentioned =
      event.authorId !== viewerId &&
      mentionsViewer(event.tags, viewerId);
    const rootId = resolveThreadRoot(event);

    if (!rootId) {
      // A top-level post is only a candidate thread root when the viewer wrote it.
      if (event.authorId !== viewerId) return;
      const record = rootRecord(channelId, event.id, event.createdAt);
      record.rootAuthorIsViewer = true;
      if (!record.author) record.author = event.authorId;
      if (!record.preview) record.preview = previewOf(event.content);
      record.lastActivityAt = later(record.lastActivityAt, event.createdAt);
      schedule();
      return;
    }

    const record = rootRecord(channelId, rootId, event.createdAt);
    record.lastActivityAt = later(record.lastActivityAt, event.createdAt);
    record.replyIds.add(event.id);
    if (event.authorId === viewerId) record.viewerReplied = true;
    if (mentioned) record.mentionedViewer = true;
    schedule();
  }

  function ingestInboxItem(item: InboxItemLike) {
    if (disposed) return;
    const rootId = item.rootId ?? item.messageId;
    const record = rootRecord(item.channelId, rootId, item.createdAt);
    if (item.authorId === viewerId && !item.thread) {
      // The unread projection lists a conversation only when it has activity,
      // so a viewer-authored top-level conversation is a started thread even
      // though we have not observed its replies directly.
      record.rootAuthorIsViewer = true;
      record.rootHasActivity = true;
      if (!record.author) record.author = item.authorId;
    }
    if (item.authorId === viewerId && item.thread) record.viewerReplied = true;
    if (item.mentioned) record.mentionedViewer = true;
    if (!record.preview) record.preview = previewOf(item.preview);
    record.lastActivityAt = later(record.lastActivityAt, item.createdAt);
    if (item.messageId !== rootId) record.replyIds.add(item.messageId);
    // The projection already knows a thread's unread count.
    if (item.thread) setUnreadCount(item.channelId, rootId, item.unreadCount);
    else schedule();
  }

  function recompute() {
    const nowSeconds = now();
    const next: ThreadEntry[] = [];
    for (const record of roots.values()) {
      if (
        options.channelAccessible &&
        !options.channelAccessible(record.channelId)
      )
        continue;
      if (nowSeconds - record.lastActivityAt > staleSeconds) continue;
      const started =
        record.rootAuthorIsViewer &&
        (record.replyIds.size >= 1 || record.rootHasActivity);
      const replied = record.viewerReplied;
      const mentioned = record.mentionedViewer;
      const following =
        !record.rootAuthorIsViewer &&
        (options.isFollowing?.(record.channelId, record.rootId) ?? false);
      const followed = following && !started && !replied;
      const reasonSet = new Set<ThreadReason>();
      if (started) reasonSet.add("started");
      if (replied) reasonSet.add("replied");
      if (mentioned) reasonSet.add("mentioned");
      if (followed) reasonSet.add("followed");
      if (!reasonSet.size) continue;
      const key = keyOf(record.channelId, record.rootId);
      next.push(
        Object.freeze({
          channelId: record.channelId,
          channelName: options.channelName(record.channelId) ?? "",
          rootId: record.rootId,
          rootPreview: record.preview,
          rootAuthor: record.author,
          lastActivityAt: record.lastActivityAt,
          replyCount: record.replyIds.size >= 1 ? record.replyIds.size : null,
          unreadCount: unread.has(key) ? (unread.get(key) ?? null) : null,
          reasons: Object.freeze(
            REASON_ORDER.filter((reason) => reasonSet.has(reason)),
          ),
        }),
      );
    }
    next.sort((a, b) => {
      const aUnread = a.unreadCount !== null && a.unreadCount > 0 ? 1 : 0;
      const bUnread = b.unreadCount !== null && b.unreadCount > 0 ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      if (a.lastActivityAt !== b.lastActivityAt)
        return b.lastActivityAt - a.lastActivityAt;
      return a.rootId.localeCompare(b.rootId);
    });
    if (sameEntries(current, next)) return;
    current = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  function fire() {
    timer = undefined;
    if (disposed || !dirty) return;
    dirty = false;
    recompute();
  }

  function schedule() {
    dirty = true;
    if (disposed || timer !== undefined) return;
    timer = setTimeout(fire, debounceMs);
  }

  return {
    ingest,
    ingestInboxItem,
    setUnreadCount,
    invalidate: schedule,
    snapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    computeNow() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      dirty = false;
      if (!disposed) recompute();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      listeners.clear();
      roots.clear();
      unread.clear();
    },
  };
}
