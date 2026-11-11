/**
 * The Threads nav-entry badge: the number of listed threads with unread
 * replies, matching how Slack badges Threads.
 *
 * Rendered by the host inside a contribution boundary, so a throw renders
 * nothing. Unknown (`null`) unread counts are not unread; a zero total renders
 * nothing at all.
 */
import type * as ReactNS from "react";
import { unreadThreadCount } from "./thread-index";
import type { ThreadsRuntime } from "./session";

export function createThreadsBadge(
  React: typeof ReactNS,
  runtime: ThreadsRuntime,
) {
  return function ThreadsBadge(): ReactNS.ReactNode {
    const state = React.useSyncExternalStore(
      runtime.subscribe,
      runtime.getSnapshot,
      runtime.getSnapshot,
    );
    if (!state.connection.ready) return null;
    const count = unreadThreadCount(state.entries);
    if (count <= 0) return null;
    return (
      <span
        aria-label={`${count} unread thread${count === 1 ? "" : "s"}`}
        style={{
          padding: "0 var(--space-1)",
          borderRadius: "var(--radius-pill)",
          background: "var(--accent-9)",
          color: "var(--accent-contrast)",
          fontSize: "0.75em",
          lineHeight: 1.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
    );
  };
}
