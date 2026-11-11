/**
 * One thread card: the root message and its latest replies, with a reply box.
 *
 * The heavy thread view is allocated only while the card is near the viewport
 * (IntersectionObserver) and disposed when it leaves or unmounts. Reading is
 * tracked only after the card is fully visible for 300 ms with the window
 * focused, per `docs/unread.md`.
 */
import type * as ReactNS from "react";
import { PREVIEW_REPLIES } from "../constants";
import type {
  ChannelMessageLike,
  ConversationInteractionsLike,
  ConversationUiLike,
  ProfileLike,
  ReadingHandleLike,
  RelaySessionLike,
  ThreadSnapshotLike,
  ThreadViewLike,
} from "../buzz-types";
import type { ThreadEntry } from "../thread-index";

export type ThreadCardProps = {
  session: RelaySessionLike;
  scope: string;
  entry: ThreadEntry;
  targeted: boolean;
  profileFor: (authorId: string) => ProfileLike | undefined;
  openThread: (channelId: string, rootId: string) => void;
  openChannel: (channelId: string) => void;
};

function hasFocus(): boolean {
  return (
    typeof document !== "undefined" &&
    document.hasFocus() &&
    document.visibilityState === "visible"
  );
}

export function createThreadCard(
  React: typeof ReactNS,
  ui: ConversationUiLike,
) {
  return function ThreadCard(props: ThreadCardProps): ReactNS.ReactNode {
    const { session, scope, entry, targeted } = props;
    const cardRef = React.useRef<HTMLLIElement | null>(null);
    const viewRef = React.useRef<ThreadViewLike | null>(null);
    const [snapshot, setSnapshot] = React.useState<ThreadSnapshotLike | null>(
      null,
    );
    const [expanded, setExpanded] = React.useState(false);

    // Allocate `session.thread` only for cards near the viewport.
    React.useEffect(() => {
      const element = cardRef.current;
      if (!element) return;
      let unsubscribe: (() => void) | undefined;
      const allocate = () => {
        if (viewRef.current) return;
        try {
          const view = session.thread(entry.channelId, entry.rootId);
          viewRef.current = view;
          setSnapshot(view.snapshot());
          unsubscribe = view.subscribe(() => setSnapshot(view.snapshot()));
          void view.refresh().catch(() => {});
        } catch {
          viewRef.current = null;
        }
      };
      const release = () => {
        unsubscribe?.();
        unsubscribe = undefined;
        try {
          viewRef.current?.dispose();
        } catch {
          /* already disposed */
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
        { rootMargin: "200px 0px" },
      );
      observer.observe(element);
      return () => {
        observer.disconnect();
        release();
      };
    }, [session, entry.channelId, entry.rootId]);

    const replies = snapshot?.replies ?? [];
    const shownReplies = expanded
      ? replies
      : replies.slice(-PREVIEW_REPLIES);
    const hiddenCount = Math.max(0, replies.length - shownReplies.length);
    const shownIds = shownReplies.map((reply) => reply.id);
    const shownIdsRef = React.useRef<readonly string[]>([]);
    shownIdsRef.current = shownIds;
    const shownIdsKey = shownIds.join(",");

    // Mark the visible replies read only after a 300 ms fully-visible dwell
    // while the window is focused. Opening the page alone marks nothing.
    React.useEffect(() => {
      const element = cardRef.current;
      if (!element) return;
      if (typeof IntersectionObserver === "undefined") return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let fullyVisible = false;
      const markRead = () => {
        timer = undefined;
        const ids = shownIdsRef.current;
        if (!ids.length) return;
        let handle: ReadingHandleLike;
        try {
          handle = session.unread.reading(entry.channelId, entry.rootId);
        } catch {
          return;
        }
        Promise.resolve(handle.observe(ids))
          .catch(() => {})
          .finally(() => {
            try {
              handle.dispose();
            } catch {
              /* already disposed */
            }
          });
      };
      const schedule = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (fullyVisible && hasFocus()) timer = setTimeout(markRead, 300);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          const first = entries[0];
          fullyVisible =
            !!first && first.isIntersecting && first.intersectionRatio >= 1;
          schedule();
        },
        { threshold: 1 },
      );
      observer.observe(element);
      if (typeof window !== "undefined") window.addEventListener("focus", schedule);
      if (typeof document !== "undefined")
        document.addEventListener("visibilitychange", schedule);
      return () => {
        observer.disconnect();
        if (timer !== undefined) clearTimeout(timer);
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
      void viewRef.current?.loadMore().catch(() => {});
    };

    const renderMessage = (
      row: ChannelMessageLike,
      interactions: ConversationInteractionsLike,
    ) =>
      React.createElement(ui.Message, {
        key: row.id,
        row,
        profile: props.profileFor(row.authorId),
        media: session.media,
        onOpenLink: interactions.onOpenLink,
        canOpenLink: interactions.canOpenLink,
        day: false,
        retry: session.messages.retry,
        session,
        scope,
      });

    const channelName = entry.channelName || entry.channelId;

    let body: ReactNS.ReactNode;
    if (!snapshot) {
      body = React.createElement("p", null, "Loading thread…");
    } else if (snapshot.status === "error") {
      body = React.createElement(
        "p",
        { role: "alert" },
        snapshot.error ?? "Could not load this thread.",
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
          children: (interactions: ConversationInteractionsLike) =>
            React.createElement(
              React.Fragment,
              null,
              snapshot.root ? renderMessage(snapshot.root, interactions) : null,
              shownReplies.map((reply) => renderMessage(reply, interactions)),
              hiddenCount > 0
                ? React.createElement(
                    "button",
                    {
                      type: "button",
                      onClick: () => {
                        setExpanded(true);
                        if (viewRef.current?.snapshot().canLoadMore) loadMore();
                      },
                    },
                    `Show ${hiddenCount} more ${hiddenCount === 1 ? "reply" : "replies"}`,
                  )
                : null,
              hiddenCount === 0 && snapshot.canLoadMore
                ? React.createElement(
                    "button",
                    { type: "button", onClick: loadMore },
                    "Load more replies",
                  )
                : null,
              React.createElement(ui.Composer, {
                session,
                scope,
                channelId: entry.channelId,
                channelName,
                threadRootId: entry.rootId,
                editMessages: replies,
                onOpenLink: interactions.onOpenLink,
                canOpenLink: interactions.canOpenLink,
              }),
            ),
        },
      );
    }

    return (
      <li
        ref={cardRef}
        className="ui-card"
        data-thread={`${entry.channelId}:${entry.rootId}`}
        data-targeted={targeted ? "true" : undefined}
        style={{
          listStyle: "none",
          padding: "var(--space-2)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          boxShadow: targeted
            ? "inset 0 0 0 2px var(--accent-9)"
            : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-2)",
          }}
        >
          <button
            type="button"
            onClick={() => props.openChannel(entry.channelId)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {`#${channelName}`}
          </button>
          <button
            type="button"
            onClick={() => props.openThread(entry.channelId, entry.rootId)}
          >
            Open thread
          </button>
        </div>
        {body}
      </li>
    );
  };
}
