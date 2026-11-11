/**
 * The Threads page. Phase 3 is a working shell that renders the thread list so
 * a sidebar row has somewhere to go; the card UI (root + replies + composer)
 * is a later dispatch.
 */
import type * as ReactNS from "react";
import type { PagePropsLike } from "../buzz-types";
import type { ThreadsRuntime } from "../session";
import { routeOf } from "./route";

export function createThreadsPage(
  React: typeof ReactNS,
  runtime: ThreadsRuntime,
) {
  return function ThreadsPage(props: PagePropsLike): ReactNS.ReactNode {
    const state = React.useSyncExternalStore(
      runtime.subscribe,
      runtime.getSnapshot,
      runtime.getSnapshot,
    );
    const route = routeOf(props.navigation?.target);
    const { connection, entries } = state;

    return (
      <section
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
          padding: "var(--space-panel-inset)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          boxSizing: "border-box",
        }}
      >
        <h2 style={{ margin: 0 }}>Threads</h2>
        {!connection.ready ? (
          <p>Connecting…</p>
        ) : entries.length === 0 ? (
          <p>
            No active threads. Threads you start, reply to, are mentioned in or
            follow will show up here.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            {entries.map((entry) => {
              const targeted =
                route.channel === entry.channelId &&
                route.root === entry.rootId;
              return (
                <li key={`${entry.channelId}:${entry.rootId}`}>
                  <button
                    type="button"
                    className="ui-card"
                    data-targeted={targeted ? "true" : undefined}
                    onClick={() =>
                      runtime.openThread(entry.channelId, entry.rootId)
                    }
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "var(--space-2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-1)",
                      cursor: "pointer",
                      boxShadow: targeted
                        ? "inset 0 0 0 2px var(--accent-9)"
                        : undefined,
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "var(--space-2)",
                      }}
                    >
                      <strong>{`#${entry.channelName || entry.channelId}`}</strong>
                      {entry.unreadCount !== null && entry.unreadCount > 0 ? (
                        <span
                          aria-label={`${entry.unreadCount} unread`}
                        >
                          {entry.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    {entry.rootPreview ? <span>{entry.rootPreview}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };
}
