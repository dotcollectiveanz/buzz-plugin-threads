const STALE_DAYS = 14;
const DEBOUNCE_MS = 150;
const SECONDS_PER_DAY = 24 * 60 * 60;

const CONTENT_KINDS = /* @__PURE__ */ new Set([9, 40002, 40008]);
const REASON_ORDER = [
  "started",
  "replied",
  "mentioned",
  "followed"
];
const UNREAD_BOUND = 1e3;
const keyOf = (channelId, rootId) => `${channelId}\0${rootId}`;
function unreadThreadCount(entries) {
  let count = 0;
  for (const entry of entries) {
    if (entry.unreadCount !== null && entry.unreadCount > 0) count++;
  }
  return count;
}
function hTag(tags) {
  const values = tags.filter((tag) => tag[0] === "h" && typeof tag[1] === "string").map((tag) => tag[1]);
  return values.length === 1 ? values[0] : void 0;
}
function mentionsViewer(tags, viewerId) {
  return tags.some((tag) => tag[0] === "p" && tag[1] === viewerId);
}
function resolveThreadRoot(event) {
  const marked = { root: void 0, reply: void 0 };
  const ids = /* @__PURE__ */ new Set();
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
  return void 0;
}
function previewOf(content) {
  return content.replace(/\s+/g, " ").trim().slice(0, 140);
}
function later(a, b) {
  return a >= b ? a : b;
}
function sameEntries(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.channelId !== y.channelId || x.channelName !== y.channelName || x.rootId !== y.rootId || x.rootPreview !== y.rootPreview || x.rootAuthor !== y.rootAuthor || x.lastActivityAt !== y.lastActivityAt || x.replyCount !== y.replyCount || x.unreadCount !== y.unreadCount || x.reasons.length !== y.reasons.length || x.reasons.some((reason, index) => reason !== y.reasons[index]))
      return false;
  }
  return true;
}
function createThreadIndex(options) {
  const viewerId = options.viewerId;
  const now = options.now ?? (() => Math.floor(Date.now() / 1e3));
  const staleSeconds = (options.staleDays ?? STALE_DAYS) * SECONDS_PER_DAY;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const roots = /* @__PURE__ */ new Map();
  const unread = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let current = Object.freeze([]);
  let timer;
  let dirty = false;
  let disposed = false;
  function rootRecord(channelId, rootId, at) {
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
        replyIds: /* @__PURE__ */ new Set()
      };
      roots.set(key, record);
    }
    return record;
  }
  function setUnreadCount(channelId, rootId, count) {
    const key = keyOf(channelId, rootId);
    unread.delete(key);
    unread.set(key, count);
    while (unread.size > UNREAD_BOUND) {
      const oldest = unread.keys().next().value;
      if (oldest === void 0) break;
      unread.delete(oldest);
    }
    schedule();
  }
  function ingest(event) {
    if (disposed || !CONTENT_KINDS.has(event.kind)) return;
    const channelId = hTag(event.tags);
    if (!channelId) return;
    const mentioned = event.authorId !== viewerId && mentionsViewer(event.tags, viewerId);
    const rootId = resolveThreadRoot(event);
    if (!rootId) {
      if (event.authorId !== viewerId) return;
      const record2 = rootRecord(channelId, event.id, event.createdAt);
      record2.rootAuthorIsViewer = true;
      if (!record2.author) record2.author = event.authorId;
      if (!record2.preview) record2.preview = previewOf(event.content);
      record2.lastActivityAt = later(record2.lastActivityAt, event.createdAt);
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
  function ingestInboxItem(item) {
    if (disposed) return;
    const rootId = item.rootId ?? item.messageId;
    const record = rootRecord(item.channelId, rootId, item.createdAt);
    if (item.authorId === viewerId && !item.thread) {
      record.rootAuthorIsViewer = true;
      record.rootHasActivity = true;
      if (!record.author) record.author = item.authorId;
    }
    if (item.authorId === viewerId && item.thread) record.viewerReplied = true;
    if (item.mentioned) record.mentionedViewer = true;
    if (!record.preview) record.preview = previewOf(item.preview);
    record.lastActivityAt = later(record.lastActivityAt, item.createdAt);
    if (item.messageId !== rootId) record.replyIds.add(item.messageId);
    if (item.thread) setUnreadCount(item.channelId, rootId, item.unreadCount);
    else schedule();
  }
  function recompute() {
    const nowSeconds = now();
    const next = [];
    for (const record of roots.values()) {
      if (options.channelAccessible && !options.channelAccessible(record.channelId))
        continue;
      if (nowSeconds - record.lastActivityAt > staleSeconds) continue;
      const started = record.rootAuthorIsViewer && (record.replyIds.size >= 1 || record.rootHasActivity);
      const replied = record.viewerReplied;
      const mentioned = record.mentionedViewer;
      const following = !record.rootAuthorIsViewer && (options.isFollowing?.(record.channelId, record.rootId) ?? false);
      const followed = following && !started && !replied;
      const reasonSet = /* @__PURE__ */ new Set();
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
          unreadCount: unread.has(key) ? unread.get(key) ?? null : null,
          reasons: Object.freeze(
            REASON_ORDER.filter((reason) => reasonSet.has(reason))
          )
        })
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
    timer = void 0;
    if (disposed || !dirty) return;
    dirty = false;
    recompute();
  }
  function schedule() {
    dirty = true;
    if (disposed || timer !== void 0) return;
    timer = setTimeout(fire, debounceMs);
  }
  return {
    ingest,
    ingestInboxItem,
    setUnreadCount,
    invalidate: schedule,
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    computeNow() {
      if (timer !== void 0) {
        clearTimeout(timer);
        timer = void 0;
      }
      dirty = false;
      if (!disposed) recompute();
    },
    dispose() {
      disposed = true;
      if (timer !== void 0) {
        clearTimeout(timer);
        timer = void 0;
      }
      listeners.clear();
      roots.clear();
      unread.clear();
    }
  };
}

const EMPTY = Object.freeze([]);
function toConnection(snapshot) {
  return {
    status: snapshot.status,
    generation: snapshot.generation,
    scope: snapshot.scope,
    viewerId: snapshot.viewer,
    ready: snapshot.status === "ready" && !!snapshot.viewer
  };
}
function sameConnection(a, b) {
  return a.status === b.status && a.generation === b.generation && a.scope === b.scope && a.viewerId === b.viewerId && a.ready === b.ready;
}
function toRelayEvent(event) {
  return {
    id: event.id,
    kind: event.kind,
    createdAt: event.created_at,
    authorId: event.pubkey,
    content: event.content,
    tags: event.tags
  };
}
const rootKey = (channelId, rootId) => `${channelId}\0${rootId}`;
function createThreadsRuntime(ctx) {
  const listeners = /* @__PURE__ */ new Set();
  const initial = ctx.relay.snapshot();
  let connection = toConnection(initial);
  let entries = EMPTY;
  let state = { connection, entries };
  let connectionKey = `${initial.scope ?? ""}:${initial.generation}`;
  let index;
  let currentSession;
  let stopObserve;
  let stopInbox;
  let stopIndex;
  let observeView;
  const unreadSubs = /* @__PURE__ */ new Map();
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
    const wanted = /* @__PURE__ */ new Set();
    for (const entry of active.snapshot()) {
      const key = rootKey(entry.channelId, entry.rootId);
      wanted.add(key);
      if (unreadSubs.has(key)) continue;
      const target = {
        kind: "thread",
        channelId: entry.channelId,
        rootId: entry.rootId
      };
      const apply = () => active.setUnreadCount(
        entry.channelId,
        entry.rootId,
        session.unread.snapshot(target).observedCount
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
    stopObserve = void 0;
    stopInbox?.();
    stopInbox = void 0;
    stopIndex?.();
    stopIndex = void 0;
    observeView?.dispose();
    observeView = void 0;
    for (const stop of unreadSubs.values()) stop();
    unreadSubs.clear();
    index?.dispose();
    index = void 0;
    currentSession = void 0;
  }
  function rebuild(snapshot) {
    teardown();
    if (snapshot.status !== "ready" || !snapshot.viewer) return;
    const session = snapshot.session;
    const viewerId = snapshot.viewer;
    currentSession = session;
    const built = createThreadIndex({
      viewerId,
      channelName: (channelId) => session.channels.list().channels.find((item) => item.id === channelId)?.name,
      isFollowing: (channelId, rootId) => session.unread.following(channelId, rootId),
      channelAccessible: () => true
    });
    index = built;
    stopIndex = built.subscribe(() => {
      publishEntries();
      reconcileUnread();
    });
    const view = session.observe([
      { kinds: [9, 40002], authors: [viewerId], limit: 200 },
      { kinds: [9, 40002], "#p": [viewerId], limit: 200 }
    ]);
    observeView = view;
    const ingestObserved = () => {
      for (const event of view.snapshot().events) built.ingest(toRelayEvent(event));
    };
    stopObserve = view.subscribe(ingestObserved);
    ingestObserved();
    void Promise.resolve(view.refresh()).catch(() => {
    });
    const syncInbox = () => {
      for (const item of session.unread.inbox().items)
        built.ingestInboxItem(item);
    };
    stopInbox = session.unread.subscribeInbox(syncInbox);
    syncInbox();
    void Promise.resolve(session.unread.ensure()).catch(() => {
    });
    publishEntries();
  }
  function sync() {
    const snapshot = ctx.relay.snapshot();
    const key = `${snapshot.scope ?? ""}:${snapshot.generation}`;
    if (key !== connectionKey || snapshot.status === "ready" && !index) {
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
    subscribe(listener) {
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
    }
  };
}

function createThreadsBadge(React, runtime) {
  return function ThreadsBadge() {
    const state = React.useSyncExternalStore(
      runtime.subscribe,
      runtime.getSnapshot,
      runtime.getSnapshot
    );
    if (!state.connection.ready) return null;
    const count = unreadThreadCount(state.entries);
    if (count <= 0) return null;
    return /* @__PURE__ */ React.createElement(
      "span",
      {
        "aria-label": `${count} unread thread${count === 1 ? "" : "s"}`,
        style: {
          padding: "0 var(--space-1)",
          borderRadius: "var(--radius-pill)",
          background: "var(--accent-9)",
          color: "var(--accent-contrast)",
          fontSize: "0.75em",
          lineHeight: 1.5,
          fontVariantNumeric: "tabular-nums"
        }
      },
      count
    );
  };
}

const CHANNEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;
const ROOT_PATTERN = /^[a-fA-F0-9]{64}$/;
function readParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value;
  const route = {};
  if (typeof record.channel === "string" && CHANNEL_PATTERN.test(record.channel))
    route.channel = record.channel;
  if (typeof record.root === "string" && ROOT_PATTERN.test(record.root))
    route.root = record.root.toLowerCase();
  return route;
}
function isThreadsRoute(params) {
  if (params === void 0) return true;
  if (!params || typeof params !== "object" || Array.isArray(params))
    return false;
  const record = params;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value !== "string") return false;
    if (key === "channel") {
      if (!CHANNEL_PATTERN.test(value)) return false;
    } else if (key === "root") {
      if (!ROOT_PATTERN.test(value)) return false;
    } else {
      return false;
    }
  }
  return true;
}
function routeOf(target) {
  if (!target) return {};
  if (target.kind === "page") {
    const route = target.route;
    return route && route.version === 1 ? readParams(route.params) : {};
  }
  if (target.kind === "plugin") return readParams(target.params);
  return {};
}

function hasFocus() {
  return typeof document !== "undefined" && document.hasFocus() && document.visibilityState === "visible";
}
function createThreadCard(React, ui) {
  return function ThreadCard(props) {
    const { session, scope, entry, targeted } = props;
    const cardRef = React.useRef(null);
    const viewRef = React.useRef(null);
    const [snapshot, setSnapshot] = React.useState(
      null
    );
    const [expanded, setExpanded] = React.useState(false);
    React.useEffect(() => {
      const element = cardRef.current;
      if (!element) return;
      let unsubscribe;
      const allocate = () => {
        if (viewRef.current) return;
        try {
          const view = session.thread(entry.channelId, entry.rootId);
          viewRef.current = view;
          setSnapshot(view.snapshot());
          unsubscribe = view.subscribe(() => setSnapshot(view.snapshot()));
          void view.refresh().catch(() => {
          });
        } catch {
          viewRef.current = null;
        }
      };
      const release = () => {
        unsubscribe?.();
        unsubscribe = void 0;
        try {
          viewRef.current?.dispose();
        } catch {
        }
        viewRef.current = null;
        setSnapshot(null);
      };
      if (typeof IntersectionObserver === "undefined") {
        allocate();
        return release;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((item) => item.isIntersecting)) allocate();
          else release();
        },
        { rootMargin: "200px 0px" }
      );
      observer.observe(element);
      return () => {
        observer.disconnect();
        release();
      };
    }, [session, entry.channelId, entry.rootId]);
    const replies = snapshot?.replies ?? [];
    const shownReplies = expanded ? replies : replies.slice(-3);
    const hiddenCount = Math.max(0, replies.length - shownReplies.length);
    const shownIds = shownReplies.map((reply) => reply.id);
    const shownIdsRef = React.useRef([]);
    shownIdsRef.current = shownIds;
    const shownIdsKey = shownIds.join(",");
    React.useEffect(() => {
      const element = cardRef.current;
      if (!element) return;
      if (typeof IntersectionObserver === "undefined") return;
      let timer;
      let fullyVisible = false;
      const markRead = () => {
        timer = void 0;
        const ids = shownIdsRef.current;
        if (!ids.length) return;
        let handle;
        try {
          handle = session.unread.reading(entry.channelId, entry.rootId);
        } catch {
          return;
        }
        Promise.resolve(handle.observe(ids)).catch(() => {
        }).finally(() => {
          try {
            handle.dispose();
          } catch {
          }
        });
      };
      const schedule = () => {
        if (timer !== void 0) {
          clearTimeout(timer);
          timer = void 0;
        }
        if (fullyVisible && hasFocus()) timer = setTimeout(markRead, 300);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          const first = entries[0];
          fullyVisible = !!first && first.isIntersecting && first.intersectionRatio >= 1;
          schedule();
        },
        { threshold: 1 }
      );
      observer.observe(element);
      if (typeof window !== "undefined") window.addEventListener("focus", schedule);
      if (typeof document !== "undefined")
        document.addEventListener("visibilitychange", schedule);
      return () => {
        observer.disconnect();
        if (timer !== void 0) clearTimeout(timer);
        if (typeof window !== "undefined")
          window.removeEventListener("focus", schedule);
        if (typeof document !== "undefined")
          document.removeEventListener("visibilitychange", schedule);
      };
    }, [session, entry.channelId, entry.rootId, shownIdsKey]);
    React.useEffect(() => {
      if (!targeted) return;
      const element = cardRef.current;
      if (element && typeof element.scrollIntoView === "function")
        element.scrollIntoView({ block: "start" });
    }, [targeted]);
    const loadMore = () => {
      void viewRef.current?.loadMore().catch(() => {
      });
    };
    const renderMessage = (row, interactions) => React.createElement(ui.Message, {
      key: row.id,
      row,
      profile: props.profileFor(row.authorId),
      media: session.media,
      onOpenLink: interactions.onOpenLink,
      canOpenLink: interactions.canOpenLink,
      day: false,
      retry: session.messages.retry,
      session,
      scope
    });
    const channelName = entry.channelName || entry.channelId;
    let body;
    if (!snapshot) {
      body = React.createElement("p", null, "Loading thread…");
    } else if (snapshot.status === "error") {
      body = React.createElement(
        "p",
        { role: "alert" },
        snapshot.error ?? "Could not load this thread."
      );
    } else if (!snapshot.root && snapshot.status !== "loading") {
      body = React.createElement("p", null, "Thread root unavailable.");
    } else {
      body = React.createElement(
        ui.Conversation,
        {
          session,
          scope,
          channelId: entry.channelId,
          channelName,
          threadId: entry.rootId,
          children: (interactions) => React.createElement(
            React.Fragment,
            null,
            snapshot.root ? renderMessage(snapshot.root, interactions) : null,
            shownReplies.map((reply) => renderMessage(reply, interactions)),
            hiddenCount > 0 ? React.createElement(
              "button",
              {
                type: "button",
                onClick: () => {
                  setExpanded(true);
                  if (viewRef.current?.snapshot().canLoadMore) loadMore();
                }
              },
              `Show ${hiddenCount} more ${hiddenCount === 1 ? "reply" : "replies"}`
            ) : null,
            hiddenCount === 0 && snapshot.canLoadMore ? React.createElement(
              "button",
              { type: "button", onClick: loadMore },
              "Load more replies"
            ) : null,
            React.createElement(ui.Composer, {
              session,
              scope,
              channelId: entry.channelId,
              channelName,
              threadRootId: entry.rootId,
              editMessages: replies,
              onOpenLink: interactions.onOpenLink,
              canOpenLink: interactions.canOpenLink
            })
          )
        }
      );
    }
    return /* @__PURE__ */ React.createElement(
      "li",
      {
        ref: cardRef,
        className: "ui-card",
        "data-thread": `${entry.channelId}:${entry.rootId}`,
        "data-targeted": targeted ? "true" : void 0,
        style: {
          listStyle: "none",
          padding: "var(--space-2)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          boxShadow: targeted ? "inset 0 0 0 2px var(--accent-9)" : void 0
        }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-2)"
          }
        },
        /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            onClick: () => props.openChannel(entry.channelId),
            style: {
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontWeight: 600
            }
          },
          `#${channelName}`
        ),
        /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            onClick: () => props.openThread(entry.channelId, entry.rootId)
          },
          "Open thread"
        )
      ),
      body
    );
  };
}

const noopUnsubscribe = () => {
};
const noopSubscribe = () => noopUnsubscribe;
const emptyProfiles = /* @__PURE__ */ new Map();
const getEmptyProfiles = () => emptyProfiles;
function navigateConversation(ctx, scope, channelId, rootId) {
  if (!scope || scope.length < 65) return;
  const viewer = scope.slice(-64);
  const communityOrigin = scope.slice(0, -65);
  if (!/^[a-f0-9]{64}$/i.test(viewer)) return;
  void ctx.navigation.open({
    version: 1,
    kind: "conversation",
    scope: { viewer, communityOrigin },
    channelId,
    ...rootId ? { messageId: rootId, threadRootId: rootId, context: "channel" } : {}
  }).catch(() => {
  });
}
function createThreadsPage(React, ctx, runtime) {
  const ui = ctx.conversation.ui;
  const ThreadCard = createThreadCard(React, ui);
  return function ThreadsPage(props) {
    const state = React.useSyncExternalStore(
      runtime.subscribe,
      runtime.getSnapshot,
      runtime.getSnapshot
    );
    const session = runtime.session();
    const profiles = React.useSyncExternalStore(
      session ? session.profiles.subscribe : noopSubscribe,
      session ? session.profiles.snapshot : getEmptyProfiles,
      session ? session.profiles.snapshot : getEmptyProfiles
    );
    const profileFor = (authorId) => profiles.get(authorId);
    const route = routeOf(props.navigation?.target);
    const { connection, entries } = state;
    const scope = connection.scope;
    const Tabs = ui.Tabs;
    const ready = connection.ready && !!session && !!scope;
    const content = (openInTab) => {
      const openThread = (channelId, rootId) => {
        if (openInTab && openInTab(channelId, rootId)) return;
        navigateConversation(ctx, scope, channelId, rootId);
      };
      const openChannel = (channelId) => navigateConversation(ctx, scope, channelId);
      return /* @__PURE__ */ React.createElement(
        "section",
        {
          style: {
            width: "100%",
            height: "100%",
            overflow: "auto",
            padding: "var(--space-panel-inset)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            boxSizing: "border-box"
          }
        },
        /* @__PURE__ */ React.createElement("h2", { style: { margin: 0 } }, "Threads"),
        !ready ? /* @__PURE__ */ React.createElement("p", null, "Connecting…") : entries.length === 0 ? /* @__PURE__ */ React.createElement("p", null, "No active threads. Threads you start, reply to, are mentioned in or follow will show up here.") : /* @__PURE__ */ React.createElement(
          "ul",
          {
            style: {
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)"
            }
          },
          entries.map((entry) => /* @__PURE__ */ React.createElement(
            ThreadCard,
            {
              key: `${entry.channelId}:${entry.rootId}`,
              session,
              scope: scope ?? "",
              entry,
              targeted: route.channel === entry.channelId && route.root === entry.rootId,
              profileFor,
              openThread,
              openChannel
            }
          ))
        )
      );
    };
    if (!ready || !Tabs) return content();
    return /* @__PURE__ */ React.createElement(
      Tabs,
      {
        id: "threads",
        session,
        scope,
        label: "Threads"
      },
      (open) => content((channelId, rootId) => open({ channelId, threadId: rootId }))
    );
  };
}

const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik00IDUuNUEyLjUgMi41IDAgMCAxIDYuNSAzaDExQTIuNSAyLjUgMCAwIDEgMjAgNS41djdBMi41IDIuNSAwIDAgMSAxNy41IDE1SDEwbC00IDN2LTNINi41QTIuNSAyLjUgMCAwIDEgNCAxMi41eiIvPjxwYXRoIGQ9Ik04IDhoOE04IDExaDUiLz48L3N2Zz4=";
const inject = ["react", "relay", "pages", "navigation", "conversation"];
function apply(ctx) {
  const React = ctx.react;
  ctx.effect(() => {
    const runtime = createThreadsRuntime(ctx);
    ctx.pages.register({
      id: "threads",
      title: "Threads",
      component: createThreadsPage(React, ctx, runtime),
      layout: "workspace",
      primary: true,
      icon: ICON,
      badge: createThreadsBadge(React, runtime),
      route: { version: 1, validate: isThreadsRoute }
    });
    return () => runtime.dispose();
  });
}

export { apply, inject };
