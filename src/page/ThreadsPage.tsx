/**
 * The Threads page: every non-stale thread as a card, ordered unread-first then
 * newest activity. When the host provides `conversation.ui.Tabs`, the list is
 * the page's first tab and "Open thread" opens a card's thread in a side pane.
 */
import type * as ReactNS from "react";
import type {
  BuzzContext,
  PagePropsLike,
  ProfileLike,
  RelaySessionLike,
} from "../buzz-types";
import type { ThreadsRuntime } from "../session";
import { routeOf } from "./route";
import { createThreadCard } from "./ThreadCard";

const noopUnsubscribe = () => {};
const noopSubscribe = () => noopUnsubscribe;
const emptyProfiles: ReadonlyMap<string, ProfileLike> = new Map();
const getEmptyProfiles = () => emptyProfiles;

function navigateConversation(
  ctx: BuzzContext,
  scope: string | undefined,
  channelId: string,
  rootId?: string,
): void {
  if (!scope || scope.length < 65) return;
  const viewer = scope.slice(-64);
  const communityOrigin = scope.slice(0, -65);
  if (!/^[a-f0-9]{64}$/i.test(viewer)) return;
  void ctx.navigation
    .open({
      version: 1,
      kind: "conversation",
      scope: { viewer, communityOrigin },
      channelId,
      ...(rootId
        ? { messageId: rootId, threadRootId: rootId, context: "channel" as const }
        : {}),
    })
    .catch(() => {});
}

export function createThreadsPage(
  React: typeof ReactNS,
  ctx: BuzzContext,
  runtime: ThreadsRuntime,
) {
  const ui = ctx.conversation.ui;
  const ThreadCard = createThreadCard(React, ui);

  return function ThreadsPage(props: PagePropsLike): ReactNS.ReactNode {
    const state = React.useSyncExternalStore(
      runtime.subscribe,
      runtime.getSnapshot,
      runtime.getSnapshot,
    );
    const session = runtime.session();
    const profiles = React.useSyncExternalStore(
      session ? session.profiles.subscribe : noopSubscribe,
      session ? session.profiles.snapshot : getEmptyProfiles,
      session ? session.profiles.snapshot : getEmptyProfiles,
    );
    const profileFor = (authorId: string) => profiles.get(authorId);
    const route = routeOf(props.navigation?.target);
    const { connection, entries } = state;
    const scope = connection.scope;
    const Tabs = ui.Tabs;
    const ready = connection.ready && !!session && !!scope;

    const content = (
      openInTab?: (channelId: string, rootId: string) => boolean,
    ) => {
      const openThread = (channelId: string, rootId: string) => {
        if (openInTab && openInTab(channelId, rootId)) return;
        navigateConversation(ctx, scope, channelId, rootId);
      };
      const openChannel = (channelId: string) =>
        navigateConversation(ctx, scope, channelId);
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
          {!ready ? (
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
                gap: "var(--space-3)",
              }}
            >
              {entries.map((entry) => (
                <ThreadCard
                  key={`${entry.channelId}:${entry.rootId}`}
                  session={session as RelaySessionLike}
                  scope={scope ?? ""}
                  entry={entry}
                  targeted={
                    route.channel === entry.channelId &&
                    route.root === entry.rootId
                  }
                  profileFor={profileFor}
                  openThread={openThread}
                  openChannel={openChannel}
                />
              ))}
            </ul>
          )}
        </section>
      );
    };

    if (!ready || !Tabs) return content();
    return (
      <Tabs
        id="threads"
        session={session}
        scope={scope}
        label="Threads"
      >
        {(open) =>
          content((channelId, rootId) => open({ channelId, threadId: rootId }))
        }
      </Tabs>
    );
  };
}
