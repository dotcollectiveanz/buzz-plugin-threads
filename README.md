# Buzz Threads

A Slack-style **Threads** experience for [Buzz](https://github.com/block/buzz-app) desktop:

- a **Threads** section in the Team sidebar, one row per thread (max 20);
- a **Threads page** (the full card UI lands in a later release);
- **per-thread unread** state, read from Buzz's own unread engine.

Threads you **started** (with ≥1 reply), **replied** in, were **@mentioned** in,
or **follow** appear here. Old threads are hidden after 14 days with no activity.

## Install

The plugin loads from the `dist/` folder, which is committed.

Managed (recommended):

```
buzz://plugin-install?repository=dotcollective%2Fbuzz-threads&ref=main&path=dist
```

Or install by hand the first time:

1. **Settings → Plugins → Manage plugins → Add**.
2. Choose **Browse** under "Add from folder" and pick this repo's `dist/` folder.
   It must be **Browse** (a dragged-in folder is copied and cannot be reloaded).
3. Review the host access (none is requested) and select **Install plugin**.

After that, rebuild (`pnpm build`) and reload the plugin from the same settings
screen; the plugin reloads from the same folder.

## What you should see

- A collapsible **Threads** section in the Team sidebar listing up to 20 threads
  as `#channel · preview`, with an unread count on threads that have unread
  replies. A header button opens the full page.
- Selecting a row opens the **Threads** page with that thread targeted.
- The page shows the full (un-capped) list of active threads, and
  "Connecting…" until the relay session is ready.

## Development

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run — thread-index unit tests, no Buzz needed
pnpm build       # tsc + vite + postbuild check → dist/plugin.js + dist/manifest.json
```

The build produces **one self-contained `dist/plugin.js`** with classic
`React.createElement` and no runtime imports, plus `dist/manifest.json`. The
postbuild step fails the build if `plugin.js` contains a top-level `import`, a
`require(` call, or a `react/jsx-runtime` reference.

### Layout

```
src/index.ts             wiring + cleanup
src/session.ts           tracks the ready relay connection; rebuilds the index on change
src/thread-index.ts      thread list data (no React)
src/sidebar.ts           sidebar section
src/page/ThreadsPage.tsx page shell (card UI later)
src/page/route.ts        page route { channel?, root? }
src/buzz-types.ts        local structural mirrors of the Buzz plugin API
src/constants.ts         MAX_ROWS=20, STALE_DAYS=14, PREVIEW_REPLIES=3
```

## Compatibility

Built against `block/buzz-app` commit
`0c66ed068a5d60139a8041558993b45f3351069a` (app version `0.7.0`).
The Buzz plugin API is a preview; re-test after each Buzz update. See
[`NOTES.md`](./NOTES.md) for the exact API shapes and source paths.

## Known gaps

- **Buzz already notifies replies in your threads.** Buzz's built-in
  notification category `thread` ("Thread replies") already banners live replies
  in conversations you are part of. Our own "Thread replies" notifications
  (a later phase) would largely duplicate it and must be narrowed or dropped;
  see the phase-0 findings in `NOTES.md`.
- **Followed threads** are readable via `session.unread.following(channelId,
  rootId)`, but that returns the *effective* state (explicit follow **or**
  participation), so an explicit follow cannot be told apart from participation.
  We use it only when the viewer did not start or reply in the thread.
- **Bounded evidence.** Thread membership is derived from Buzz's bounded unread
  projection (`session.unread.inbox()`), which retains a recent window of
  verified events. Very old threads may be missing until new activity.
  A static `session.observe` filter cannot express "replies to my posts"
  (it would need `#e` = dynamic root ids), so the unread projection is the
  primary source, mirroring the bundled Inbox.
- **`sidebarSections` may be absent** on older hosts. The plugin then registers
  the page as `primary: true` so it still has a navigation entry.
