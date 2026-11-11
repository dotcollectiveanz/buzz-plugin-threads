/**
 * Tracks the current ready relay connection and keeps a thread index for it.
 *
 * Mirrors `docs/relay-queries.md`: subscribe to connection replacement, key all
 * state on `scope:generation`, and only use the session when `status === ready`.
 * Every view, subscription and timer this owns is torn down on `dispose()`,
 * which the plugin calls from `ctx.effect`.
 */

import { createThreadIndex, type ThreadEntry, type ThreadIndex } from "./thread-index";
import type {
  BuzzContext,
  EventDataLike,
  RelaySessionLike,
  RelaySnapshotLike,
  Unsubscribe,
} from "./buzz-types";

const EMPTY: readonly ThreadEntry[] = Object.freeze([]);

export type ThreadsConnection = {
  status: RelaySnapshotLike["status"];
  generation: number;
  scope: string | undefined;
  viewerId: string | undefined;
  ready: boolean;
};

export type ThreadsSnapshot = {
  connection: ThreadsConnection;
  entries: readonly ThreadEntry[];
};

export type ThreadsRuntime = {
  subscribe(listener: () => void): Unsubscribe;
  getSnapshot(): ThreadsSnapshot;
  /** The live session while ready, for thread cards (phase 4). */
  session(): RelaySessionLike | undefined;
  dispose(): void;
};

function toConnection(snapshot: RelaySnapshotLike): ThreadsConnection {
  return {
    status: snapshot.status,
    generation: snapshot.generation,
    scope: snapshot.scope,
    viewerId: snapshot.viewer,
    ready: snapshot.status === "ready" && !!snapshot.viewer,
  };
}

function sameConnection(a: ThreadsConnection, b: ThreadsConnection): boolean {
  return (
    a.status === b.status &&
    a.generation === b.generation &&
    a.scope === b.scope &&
    a.viewerId === b.viewerId &&
    a.ready === b.ready
  );
}

function toRelayEvent(event: EventDataLike) {
  return {
    id: event.id,
    kind: event.kind,
    createdAt: event.created_at,
    authorId: event.pubkey,
    content: event.content,
    tags: event.tags,
  };
}

const rootKey = (channelId: string, rootId: string) =>
  `${channelId}\u0000${rootId}`;

export function createThreadsRuntime(ctx: BuzzContext): ThreadsRuntime {
  const listeners = new Set<() => void>();
  const initial = ctx.relay.snapshot();
  let connection = toConnection(initial);
  let entries: readonly ThreadEntry[] = EMPTY;
  let state: ThreadsSnapshot = { connection, entries };
  let connectionKey = `${initial.scope ?? ""}:${initial.generation}`;

  let index: ThreadIndex | undefined;
  let currentSession: RelaySessionLike | undefined;
  let stopObserve: Unsubscribe | undefined;
  let stopInbox: Unsubscribe | undefined;
  let stopIndex: Unsubscribe | undefined;
  let observeView: { dispose(): void } | undefined;
  const unreadSubs = new Map<string, Unsubscribe>();
  let disposed = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  function publishEntries() {
    const next = index ? index.snapshot() : EMPTY;
    if (entries === next) return;
    entries = next;
    state = { connection, entries };
    notify();
  }

  function reconcileUnread() {
    const session = currentSession;
    const active = index;
    if (!session || !active) return;
    const wanted = new Set<string>();
    for (const entry of active.snapshot()) {
      const key = rootKey(entry.channelId, entry.rootId);
      wanted.add(key);
      if (unreadSubs.has(key)) continue;
      const target = {
        kind: "thread" as const,
        channelId: entry.channelId,
        rootId: entry.rootId,
      };
      const apply = () =>
        active.setUnreadCount(
          entry.channelId,
          entry.rootId,
          session.unread.snapshot(target).observedCount,
        );
      const stop = session.unread.subscribe(target, apply);
      unreadSubs.set(key, stop);
      apply();
    }
    for (const [key, stop] of unreadSubs) {
      if (wanted.has(key)) continue;
      stop();
      unreadSubs.delete(key);
    }
  }

  function teardown() {
    stopObserve?.();
    stopObserve = undefined;
    stopInbox?.();
    stopInbox = undefined;
    stopIndex?.();
    stopIndex = undefined;
    observeView?.dispose();
    observeView = undefined;
    for (const stop of unreadSubs.values()) stop();
    unreadSubs.clear();
    index?.dispose();
    index = undefined;
    currentSession = undefined;
  }

  function rebuild(snapshot: RelaySnapshotLike) {
    teardown();
    if (snapshot.status !== "ready" || !snapshot.viewer) return;
    const session = snapshot.session;
    const viewerId = snapshot.viewer;
    currentSession = session;

    const built = createThreadIndex({
      viewerId,
      channelName: (channelId) =>
        session.channels.list().channels.find((item) => item.id === channelId)
          ?.name,
      isFollowing: (channelId, rootId) =>
        session.unread.following(channelId, rootId),
      channelAccessible: () => true,
    });
    index = built;
    stopIndex = built.subscribe(() => {
      publishEntries();
      reconcileUnread();
    });

    const view = session.observe([
      { kinds: [9, 40002], authors: [viewerId], limit: 200 },
      { kinds: [9, 40002], "#p": [viewerId], limit: 200 },
    ]);
    observeView = view;
    const ingestObserved = () => {
      for (const event of view.snapshot().events) built.ingest(toRelayEvent(event));
    };
    stopObserve = view.subscribe(ingestObserved);
    ingestObserved();
    void Promise.resolve(view.refresh()).catch(() => {});

    const syncInbox = () => {
      for (const item of session.unread.inbox().items)
        built.ingestInboxItem(item);
    };
    stopInbox = session.unread.subscribeInbox(syncInbox);
    syncInbox();

    void Promise.resolve(session.unread.ensure()).catch(() => {});
    publishEntries();
  }

  function sync() {
    const snapshot = ctx.relay.snapshot();
    const key = `${snapshot.scope ?? ""}:${snapshot.generation}`;
    if (key !== connectionKey || (snapshot.status === "ready" && !index)) {
      connectionKey = key;
      rebuild(snapshot);
    }
    const next = toConnection(snapshot);
    if (!sameConnection(connection, next)) {
      connection = next;
      state = { connection, entries };
      notify();
    }
  }

  const stopRelay = ctx.relay.subscribe(sync);
  sync();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    session: () => currentSession,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopRelay();
      teardown();
      listeners.clear();
    },
  };
}
