# Buzz Threads — working notes

## Target

- Reference repo: `~/dev/buzz-app` (`https://github.com/block/buzz-app.git`)
- Commit built against: `0c66ed068a5d60139a8041558993b45f3351069a`
  (2026-11-10, `feat(charts): bundle a Charts code-block renderer (#3226)`, branch `main`)
- App version in that checkout: `src-tauri/tauri.conf.json` → `0.7.0`; package
  `buzz-foundation`, `pnpm@11.8.0`, Node >= 24.
- Plugin id: `au.com.dotcollective.threads`. Local checkout: `~/dev/buzz-threads`.

The plugin API is a preview. Everything below is quoted from the checkout above;
re-verify on each Buzz update.

---

## Phase 0 findings

### Q(a). Can a plugin read "followed threads" state? — YES

`session.unread.following(channelId, rootId): boolean` is part of the exported
`UnreadCapability` (the plugin-facing type re-exported from
`src/plugins/author.ts` as `UnreadCapability`).
Source: `src/features/relay/unread.ts` lines ~157-162 and `src/features/relay/read-state-model.ts`.

```ts
// src/features/relay/unread.ts (UnreadCapability)
/** Whether the viewer follows this canonical root: an explicit choice,
 * otherwise writing or replying anywhere in its thread. */
following(channelId: string, rootId: string): boolean;
/** Saves an explicit choice on this device; throws, unchanged, if not saved. */
follow(channelId: string, rootId: string, following: boolean): void;
```

Caveat: `following()` returns the **effective** state, i.e. an explicit Follow
choice **or** "the viewer wrote the root or replied anywhere in its thread".
There is no separate reader that isolates only explicit follows, so a plugin
cannot tell an explicit follow apart from participation. For our reasons list we
use `following()` as the "followed" signal only when "started"/"replied" are not
already present, to avoid labelling every participating thread "followed".

Follows are device-local (`buzz.thread-follows.v1:<partition>` in localStorage;
docs/unread.md "Relevant replies" §Follow thread), so this is a per-device read.
Not a blocker: exposed to plugins.

### Q(b). Does Buzz already send an OS notification/banner for replies in threads the viewer participates in? — YES

Buzz has a built-in notification category `thread` labelled **"Thread replies"**:

```ts
// src/features/notifications/service.ts lines 65-70
const categories = Object.freeze([
  { key: "mention", label: "Mentions" },
  { key: "direct", label: "Direct messages" },
  { key: "thread", label: "Thread replies" },
  { key: "agent", label: "Solo chat completions" },
]);
```

When it fires (docs/notifications.md "Running-app behavior", and the
"Relevant replies" rule in docs/unread.md):

- On live, relay-verified kind-9 / kind-40002 traffic in the **selected**
  community. No new socket or background-community subscription.
- Only for a reply that counts as a **relevant reply** — i.e. a reply in one of
  the viewer's conversations. A conversation is direct replies to one parent;
  the viewer is part of it when they wrote the parent, replied anywhere under
  the same canonical root, or explicitly followed. Same rule that feeds channel
  and thread unread counts, thread activity and the Inbox.
- Suppressed when: the reply is the viewer's own; it is history/replay
  (initial/reconnect replay); older than 2 minutes (or > 30s in the future);
  the channel is muted (mute suppresses DM + participating-thread alerts but
  **not** explicit mentions); category/master off; no OS permission; access
  revoked; window is focused and the conversation is visibly active
  (visibility is checked after UI presentation, without publishing read
  intent); the message is signed `audience=agents` (quiet agent messages).
- A reply whose conversation membership lookup is still pending is held as a
  `thread` candidate and dropped if it decides the viewer is not in it.

**Consequence for our plugin (matches scope §6): our own "thread replies"
notifications would duplicate Buzz's built-in `thread` category almost exactly.**
Per the scope, phase 5 must either narrow to cases Buzz misses or drop the
feature and record it. This is deferred to phase 5 (STOP after phase 3); noted
here and in README "Known gaps".

### Q4. How the Inbox reference works ("which threads am I in")

`src/bundled/inbox` does **not** run its own relay queries. Its page consumes
the session-wide unread projection:

- `session.unread.inbox()` + `session.unread.subscribeInbox(...)` → an
  `InboxSnapshot` of `InboxItem`s (`src/features/relay/inbox.ts`).
- Each `InboxItem` carries `channelId`, `rootId?`, `thread`, `messageId`,
  `latestMessageId`, `authorId`, `preview`, `createdAt`, `unreadCount`,
  `mentioned`, `manual`, `target` (a `ReadTarget`).
- "Which threads am I in" (started / replied / mentioned / followed) is computed
  inside `src/features/relay/unread.ts` from bounded verified evidence using the
  **relevant replies** rule; the Inbox just renders it.
- Unread per thread: `session.unread.snapshot({ kind: "thread", channelId, rootId })`.
- Opening a thread in a side pane: `ctx.conversation.ui.Tabs` render-prop
  (`PageTabsProps.children(open, close, isOpen)`), with
  `open({ channelId, threadId })` where the target is `PageTabTarget`.
  The Activity page passes `tabs={ctx.conversation.ui.Tabs}` into `InboxPage`.

So the honest "copy the Inbox approach" answer is: the primary source is the
**unread projection** (`unread.inbox()` / `unread.snapshot(thread)` /
`unread.following()`), not hand-rolled `session.observe` filters. Scope §6
nonetheless specifies `session.observe` filters for the event sources; see
"Source wiring" below and README "Known gaps".

---

## Confirmed API shapes (with source paths)

### `sidebarSections` registration — `src/features/channel-navigation/sidebar-sections-service.ts`

Read with `ctx.reflect.get("sidebarSections")` (optional service; may be
`undefined` on older hosts). Exact contribution shape:

```ts
type SidebarSectionRow = Readonly<{
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string;
  count?: number;
  status?: string;
}>;
type SidebarSectionAction = Readonly<{
  id: string;
  label: string;
  icon: ReactElement;          // required, a ReactElement (not a string)
  onSelect: () => void | Promise<void>;
}>;
type SidebarSectionContribution = Readonly<{
  version: 1;
  id: string;                  // /^[a-z0-9][a-z0-9._-]*$/
  title: string;
  icon: ReactNode;             // required, non-null
  rows: Readonly<{
    snapshot: () => readonly SidebarSectionRow[];
    subscribe: (listener: () => void) => () => void;
  }>;
  select: (row: SidebarSectionRow) => OpenTarget;   // pure
  actions?: readonly SidebarSectionAction[];
}>;
```

Host rendering (`SidebarContributionSection.tsx`) joins non-empty
`badge` / `count` (Intl-formatted number) / `status` into one metadata string
separated by " · "; rows need unique ids and non-empty labels. Rows are validated;
a throw replaces only that section with an unavailable state + Retry.

### `session.unread` thread target — `src/features/relay/read-state-model.ts`

```ts
type ReadTarget =
  | Readonly<{ kind: "channel"; channelId: string }>
  | Readonly<{ kind: "thread"; channelId: string; rootId: string }>
  | Readonly<{ kind: "message"; channelId: string; messageId: string }>;
```

`session.unread.snapshot({ kind: "thread", channelId, rootId })` →
`UnreadSnapshot` with `observedCount: number | null` (null = unknown/denied, never
a fabricated zero), `attentionCount`, `latestMessage`, `manual`, `coverage`,
`freshness`. Subscribe with `session.unread.subscribe(target, listener)`.
Reading: `session.unread.reading(channelId, rootId)` → `ReadingHandle`
(`observe(ids)`, `view(...)`, `catchUp(...)`, `dispose()`).

### `session.thread(...)` — `src/features/relay/session.ts` (~line 2782), type in `src/features/relay/threads.ts`

```ts
session.thread(
  channelId: string,
  messageId: string,
  options?: { exact?: boolean; priority?: Priority },
): ThreadView & { dispose(): void };
```

`ThreadView`:

```ts
type ThreadSnapshot = Readonly<{
  status: "idle" | "loading" | "ready" | "error";
  root: ChannelMessage | undefined;
  replies: readonly ChannelMessage[];
  error: string | undefined;
  canLoadMore: boolean;
  limited: boolean;
  direction?: "older" | "forward";
  readKind?: "older" | "refresh";
  target?: ChannelMessage | undefined;
  targetStatus?: "loading" | "ready" | "unavailable" | "error";
}>;
type ThreadView = {
  snapshot(): ThreadSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  retarget(messageId: string, signal: AbortSignal): Promise<ThreadRetarget>;
  dispose(): void;
};
```

Owned handle; ≤64 owned handles per session; dispose on unmount. Allocate in a
React effect (not render/useMemo).

### Navigation `OpenTarget` for a plugin page — `src/features/navigation/targets.ts`

Two accepted forms that carry params:

```ts
// kind "page": direct page target with typed route params
{ version: 1, kind: "page", pluginId, pageId,
  route?: { version: number, params: JsonValue } }

// kind "plugin": link form (`buzz://plugin?...`); params are strings and are
// resolved in place to an ordinary page target once the runtime has settled.
{ version: 1, kind: "plugin", pluginId, pageId?, params?: Record<string,string> }
```

`ctx.navigation.open(target)` → `{ status: "opened" | "failed" | "superseded" | "cancelled" }`.
Other kinds: `{ kind: "home" }`, `{ kind: "settings", section? }`,
`{ kind: "conversation", scope, channelId, messageId?, threadRootId?, ... }`.

Page route opt-in (`src/features/pages/service.ts`):

```ts
route?: Readonly<{ version: number; validate(params: JsonValue): boolean }>;
```

`params` are only applied when the page declares a route and `validate` accepts.

### Side pane: `ctx.conversation.ui.Tabs` — `src/features/conversation/contracts.ts` + `service.tsx`

`conversation.ui.Tabs` is an **optional** React component (provided while the
Channels/provider plugin runs). Signature `(props: PageTabsProps) => ReactNode`:

```ts
type PageTabTarget = { channelId: string; threadId?: string; messageId?: string };
type PageTabOptions = { keep?: boolean; markRead?: boolean };
type PageTabsProps = {
  id: string; session: RelaySession; scope: string; label: string; icon?: ReactNode;
  children(
    open: (target: PageTabTarget, options?: PageTabOptions) => boolean,
    close: (target: PageTabTarget) => boolean,
    isOpen: (target: PageTabTarget) => boolean,
  ): ReactNode;
  visits?: boolean;
};
```

So "open a thread in a side pane" = render `<Tabs id=… session=… scope=… label=…>{(open) => …}</Tabs>`
and call `open({ channelId, threadId })`. There is no `Tabs.open` free function.
If `ui.Tabs` is absent (provider plugin not running), fall back to navigation to
a conversation target with `threadRootId`.

### Notifications — `src/features/notifications/service.ts`

```ts
const { submit } = ctx.notifications.register({ id, label });
await submit({ sourceKey, target, title?, body? }); // target is an OpenTarget
```

`sourceKey` dedupes; `submit()` means "accepted for policy checks". Click opens
`target` via the host. Category ids match `/^[a-z0-9][a-z0-9._-]{0,127}$/`.

### Plugin module contract — `src/plugins/api.ts`, docs/plugin-architecture.md §Plugin module contract

Manifest keys: `id`, `name`, `apiVersion: 1`, optional `description`,
`discovery` (`category`, `tags`), optional `updates: { defaultEnabled: boolean }`,
optional `host`. Other keys are rejected. Module exports `inject?` and
`apply(ctx)`; module top level must be pure; `apply` < 10s.

Classic JSX: "normal JSX compiles against the local `React` variable. Components
in other files can be created by a factory receiving that same React instance."
→ our `.tsx` files export factories taking `React` as a parameter; no runtime
`react` import.

Relay service: `ctx.relay.snapshot()` → `{ status, generation, session, viewer,
scope?, origin?, ... }`; subscribe to rebuild on replacement. Only use when
`status === "ready"`; key on `scope:generation`.

---

## Source wiring (planned; phase 2 → phase 3)

Scope §6 says: live via `session.observe`, mirroring Inbox — viewer replies
(kind 9 with a NIP-10 root `e` tag, resolve the real root), viewer top-level posts
with ≥1 reply, and events with `#p` = viewer; unread from
`session.unread.snapshot({ kind: "thread", … })`; followed threads via whatever
Inbox/session uses.

Findings that constrain this:

- The Inbox itself uses `session.unread.inbox()` (the unread projection), not
  `session.observe`. `session.observe(filters)` returns a retained, bounded view
  (≤2000 remote events / 8 MiB) that merges local operations and live traffic
  matching the filters, and supports `refresh`/`dispose`.
- A static `session.observe` filter cannot express "replies to **my** posts"
  (that needs `#e` = my dynamic root ids). The robust, Inbox-faithful source is
  the unread projection.
- `session.unread.inbox()` **is** exposed to plugins (`UnreadCapability.inbox`).

Decision for phase 2: implement `src/thread-index.ts` as a pure, testable store
that ingests events (with NIP-10 root resolution) and exposes a stable
`snapshot()`/`subscribe()`. Because a static `session.observe` filter cannot
express "replies to my posts", the production wiring (`src/session.ts`) also
ingests `session.unread.inbox()` items via `ingestInboxItem`, which is the
Inbox-faithful source. Unread per thread comes from
`session.unread.snapshot({ kind: "thread", … })`; follow state from
`session.unread.following(...)`. Recorded as a known gap/deviation.

For a viewer-authored top-level conversation surfaced by the unread projection,
`ingestInboxItem` records `rootHasActivity` (the projection lists a conversation
only when it has activity), which satisfies the "started" reason; `replyCount`
stays `null` (unknown) rather than a fabricated zero.

---

## Build status (phases 0-3)

- `pnpm typecheck` — clean.
- `pnpm test` — 17 tests pass (`src/thread-index.test.ts`), no Buzz needed.
- `pnpm build` — `dist/plugin.js` (~21 kB, single file) + `dist/manifest.json`;
  postbuild fails on any top-level `import`, `require(`, or `react/jsx-runtime`.
- Output verified: one file, classic `React.createElement`, only
  `export { apply, inject }`, no CSS/assets.


---

## Could not verify / uncertain

- Exact NIP-10 convention: Buzz's own reply builder uses
  `["e", resolvedRootId, "", "reply"]` (docs/relay-queries.md), i.e. the `reply`
  marker names the **canonical root**, not the direct parent. Our parser treats
  a `root`-marked or `reply`-marked `e` (and a single untagged `e`) as the root.
- Whether `ctx.reflect.get("sidebarSections")` is present in Joel's installed
  Buzz build (0.7.0). Code degrades to a `primary: true` page if absent.
- Whether `session.unread.inbox()`'s bounded evidence covers old threads — docs
  say bounded (≤4096 events / 8 MiB), so very old threads may be missing until
  new activity. Scope §11 already flags this.
- Whether the installed host accepts `updates` in the manifest — we omit it.
