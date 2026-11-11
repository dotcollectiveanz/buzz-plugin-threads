const MAX_ROWS = 20;
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

const PLUGIN_ID = "au.com.dotcollective.threads";
const PAGE_ID = "threads";
const EMPTY = Object.freeze([]);
function threadTarget(channelId, rootId) {
  const params = {};
  if (channelId) params.channel = channelId;
  if (rootId) params.root = rootId;
  return {
    version: 1,
    kind: "plugin",
    pluginId: PLUGIN_ID,
    pageId: PAGE_ID,
    ...Object.keys(params).length ? { params } : {}
  };
}
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
    openTarget: threadTarget,
    openThread(channelId, rootId) {
      void ctx.navigation.open(threadTarget(channelId, rootId)).catch(() => {
      });
    },
    openAll() {
      void ctx.navigation.open(threadTarget()).catch(() => {
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopRelay();
      teardown();
      listeners.clear();
    }
  };
}

function createThreadsSidebar(React, ctx, runtime) {
  const targets = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let rows = Object.freeze([]);
  let stop;
  function rebuild() {
    const { entries } = runtime.getSnapshot();
    targets.clear();
    const next = entries.slice(0, MAX_ROWS).map((entry) => {
      const id = `${entry.channelId}:${entry.rootId}`;
      targets.set(id, { channelId: entry.channelId, rootId: entry.rootId });
      const name = entry.channelName || entry.channelId;
      const label = entry.rootPreview ? `#${name} · ${entry.rootPreview}` : `#${name}`;
      const count = entry.unreadCount !== null && entry.unreadCount > 0 ? entry.unreadCount : void 0;
      return Object.freeze({
        id,
        label,
        ...count !== void 0 ? { count } : {}
      });
    });
    rows = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function select(row) {
    const target = targets.get(row.id);
    return target ? threadTarget(target.channelId, target.rootId) : threadTarget();
  }
  return {
    register() {
      const sections = ctx.reflect.get(
        "sidebarSections"
      );
      if (!sections || typeof sections.register !== "function") return;
      const viewAll = {
        id: "view-all",
        label: "View all threads",
        icon: React.createElement("span", { "aria-hidden": true }, "≡"),
        onSelect: () => runtime.openAll()
      };
      sections.register({
        version: 1,
        id: "threads",
        title: "Threads",
        icon: "#",
        rows: { snapshot: () => rows, subscribe },
        select,
        actions: [viewAll]
      });
      stop = runtime.subscribe(rebuild);
      rebuild();
    },
    dispose() {
      stop?.();
      stop = void 0;
      listeners.clear();
    }
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

function createThreadsPage(React, runtime) {
  return function ThreadsPage(props) {
    const state = React.useSyncExternalStore(
      runtime.subscribe,
      runtime.getSnapshot,
      runtime.getSnapshot
    );
    const route = routeOf(props.navigation?.target);
    const { connection, entries } = state;
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
      !connection.ready ? /* @__PURE__ */ React.createElement("p", null, "Connecting…") : entries.length === 0 ? /* @__PURE__ */ React.createElement("p", null, "No active threads. Threads you start, reply to, are mentioned in or follow will show up here.") : /* @__PURE__ */ React.createElement(
        "ul",
        {
          style: {
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)"
          }
        },
        entries.map((entry) => {
          const targeted = route.channel === entry.channelId && route.root === entry.rootId;
          return /* @__PURE__ */ React.createElement("li", { key: `${entry.channelId}:${entry.rootId}` }, /* @__PURE__ */ React.createElement(
            "button",
            {
              type: "button",
              className: "ui-card",
              "data-targeted": targeted ? "true" : void 0,
              onClick: () => runtime.openThread(entry.channelId, entry.rootId),
              style: {
                width: "100%",
                textAlign: "left",
                padding: "var(--space-2)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-1)",
                cursor: "pointer",
                boxShadow: targeted ? "inset 0 0 0 2px var(--accent-9)" : void 0
              }
            },
            /* @__PURE__ */ React.createElement(
              "span",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "var(--space-2)"
                }
              },
              /* @__PURE__ */ React.createElement("strong", null, `#${entry.channelName || entry.channelId}`),
              entry.unreadCount !== null && entry.unreadCount > 0 ? /* @__PURE__ */ React.createElement(
                "span",
                {
                  "aria-label": `${entry.unreadCount} unread`
                },
                entry.unreadCount
              ) : null
            ),
            entry.rootPreview ? /* @__PURE__ */ React.createElement("span", null, entry.rootPreview) : null
          ));
        })
      )
    );
  };
}

const inject = ["react", "relay", "pages", "navigation"];
function apply(ctx) {
  const React = ctx.react;
  ctx.effect(() => {
    const runtime = createThreadsRuntime(ctx);
    const sections = ctx.reflect.get("sidebarSections");
    const hasSidebar = !!sections && typeof sections.register === "function";
    ctx.pages.register({
      id: "threads",
      title: "Threads",
      component: createThreadsPage(React, runtime),
      layout: "workspace",
      // Fallback only: without a sidebar section the page needs a nav entry.
      primary: !hasSidebar,
      route: { version: 1, validate: isThreadsRoute }
    });
    const sidebar = hasSidebar ? createThreadsSidebar(React, ctx, runtime) : void 0;
    sidebar?.register();
    return () => {
      sidebar?.dispose();
      runtime.dispose();
    };
  });
}

export { apply, inject };
