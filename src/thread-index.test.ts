import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createThreadIndex,
  resolveThreadRoot,
  type RelayEventLike,
  type ThreadEntry,
  type ThreadIndexOptions,
} from "./thread-index";

const VIEWER = "a".repeat(64);
const OTHER = "b".repeat(64);
const DAY = 24 * 60 * 60;
const BASE = 1_800_000_000; // fixed epoch seconds

function event(
  overrides: Partial<RelayEventLike> & Pick<RelayEventLike, "id" | "authorId">,
): RelayEventLike {
  return {
    kind: 9,
    createdAt: BASE,
    content: "hello",
    tags: [],
    ...overrides,
  };
}

function make(overrides: Partial<ThreadIndexOptions> = {}) {
  const index = createThreadIndex({
    viewerId: VIEWER,
    channelName: (id) => `channel-${id}`,
    now: () => BASE,
    ...overrides,
  });
  return index;
}

function ids(entries: readonly ThreadEntry[]) {
  return entries.map((entry) => entry.rootId);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("relevance reasons", () => {
  it("marks a viewer root 'started' only once it has a reply", () => {
    const index = make();
    const root = "1".repeat(64);
    index.ingest(
      event({ id: root, authorId: VIEWER, tags: [["h", "c1"]] }),
    );
    index.computeNow();
    expect(index.snapshot()).toEqual([]);

    index.ingest(
      event({
        id: "2".repeat(64),
        authorId: OTHER,
        tags: [["h", "c1"], ["e", root, "", "reply"]],
      }),
    );
    index.computeNow();
    const [entry] = index.snapshot();
    expect(entry.rootId).toBe(root);
    expect(entry.reasons).toEqual(["started"]);
    expect(entry.replyCount).toBe(1);
    expect(entry.rootAuthor).toBe(VIEWER);
  });

  it("marks a viewer reply 'replied'", () => {
    const index = make();
    const root = "3".repeat(64);
    index.ingest(
      event({
        id: "4".repeat(64),
        authorId: VIEWER,
        tags: [["h", "c2"], ["e", root, "", "reply"]],
      }),
    );
    index.computeNow();
    const [entry] = index.snapshot();
    expect(entry.rootId).toBe(root);
    expect(entry.reasons).toEqual(["replied"]);
  });

  it("marks a reply that mentions the viewer 'mentioned'", () => {
    const index = make();
    const root = "5".repeat(64);
    index.ingest(
      event({
        id: "6".repeat(64),
        authorId: OTHER,
        tags: [
          ["h", "c3"],
          ["e", root, "", "reply"],
          ["p", VIEWER],
        ],
      }),
    );
    index.computeNow();
    const [entry] = index.snapshot();
    expect(entry.rootId).toBe(root);
    expect(entry.reasons).toEqual(["mentioned"]);
  });

  it("marks a followed thread 'followed' when the viewer never posted", () => {
    const index = make({
      isFollowing: (channelId, rootId) =>
        channelId === "c4" && rootId === "7".repeat(64),
    });
    index.ingest(
      event({
        id: "8".repeat(64),
        authorId: OTHER,
        tags: [["h", "c4"], ["e", "7".repeat(64), "", "reply"]],
      }),
    );
    index.computeNow();
    const [entry] = index.snapshot();
    expect(entry.reasons).toEqual(["followed"]);
  });

  it("does not label a viewer root 'followed' with no replies", () => {
    const index = make({ isFollowing: () => true });
    index.ingest(
      event({
        id: "9".repeat(64),
        authorId: VIEWER,
        tags: [["h", "c5"], ["e", "a".repeat(10), "", "reply"]],
      }),
    );
    index.computeNow();
    // The viewer reply makes it relevant; the started root itself is not listed.
    expect(ids(index.snapshot())).toEqual(["a".repeat(10)]);
    expect(index.snapshot()[0].reasons).toEqual(["replied"]);
  });
});

describe("root resolution from NIP-10 tags", () => {
  it("uses a 'reply'-marked e tag as the canonical root", () => {
    expect(
      resolveThreadRoot({
        id: "x",
        tags: [["e", "root-a", "", "reply"]],
      }),
    ).toBe("root-a");
  });

  it("prefers a 'root'-marked e tag", () => {
    expect(
      resolveThreadRoot({
        id: "x",
        tags: [
          ["e", "parent", "", "reply"],
          ["e", "root-b", "", "root"],
        ],
      }),
    ).toBe("root-b");
  });

  it("treats a single untagged e tag as the legacy root", () => {
    expect(
      resolveThreadRoot({ id: "x", tags: [["e", "only"]] }),
    ).toBe("only");
  });

  it("ignores self-references and ambiguous multi-reference events", () => {
    expect(
      resolveThreadRoot({
        id: "x",
        tags: [
          ["e", "x"],
          ["e", "one"],
          ["e", "two"],
        ],
      }),
    ).toBeUndefined();
  });
});

describe("stale filtering", () => {
  it("drops threads without activity for more than STALE_DAYS", () => {
    let clock = BASE;
    const index = make({ now: () => clock });
    const freshRoot = "a1".repeat(32);
    const staleRoot = "b1".repeat(32);
    // Viewer replies to two threads 15 days apart in activity.
    index.ingest(
      event({
        id: "f1".repeat(32),
        authorId: VIEWER,
        createdAt: BASE,
        tags: [["h", "c1"], ["e", freshRoot, "", "reply"]],
      }),
    );
    index.ingest(
      event({
        id: "f2".repeat(32),
        authorId: VIEWER,
        createdAt: BASE - 15 * DAY,
        tags: [["h", "c1"], ["e", staleRoot, "", "reply"]],
      }),
    );
    clock = BASE + 13 * DAY;
    index.computeNow();
    expect(ids(index.snapshot())).toEqual([freshRoot]);

    clock = BASE + 15 * DAY;
    index.computeNow();
    expect(index.snapshot()).toEqual([]);
  });
});

describe("ordering", () => {
  it("puts unread threads first, then newest activity", () => {
    let clock = BASE;
    const index = make({ now: () => clock });
    const older = "a2".repeat(32);
    const newer = "b2".repeat(32);
    index.ingest(
      event({
        id: "r1".repeat(32),
        authorId: VIEWER,
        createdAt: BASE,
        tags: [["h", "c1"], ["e", older, "", "reply"]],
      }),
    );
    index.ingest(
      event({
        id: "r2".repeat(32),
        authorId: VIEWER,
        createdAt: BASE + 60,
        tags: [["h", "c1"], ["e", newer, "", "reply"]],
      }),
    );
    index.computeNow();
    // Newest activity first, both not unread.
    expect(ids(index.snapshot())).toEqual([newer, older]);

    index.setUnreadCount("c1", older, 3);
    index.computeNow();
    // Unread moves the older thread to the top.
    expect(ids(index.snapshot())).toEqual([older, newer]);
    expect(index.snapshot()[0].unreadCount).toBe(3);
  });
});

describe("unread counts", () => {
  it("distinguishes unknown (null) from zero", () => {
    const index = make();
    const root = "c3".repeat(32);
    index.ingest(
      event({
        id: "u1".repeat(32),
        authorId: VIEWER,
        tags: [["h", "c1"], ["e", root, "", "reply"]],
      }),
    );
    index.computeNow();
    expect(index.snapshot()[0].unreadCount).toBeNull();

    index.setUnreadCount("c1", root, 0);
    index.computeNow();
    expect(index.snapshot()[0].unreadCount).toBe(0);

    index.setUnreadCount("c1", root, 5);
    index.computeNow();
    expect(index.snapshot()[0].unreadCount).toBe(5);

    index.setUnreadCount("c1", root, null);
    index.computeNow();
    expect(index.snapshot()[0].unreadCount).toBeNull();
  });
});

describe("debounce", () => {
  it("coalesces a burst of input into one recompute", () => {
    vi.useFakeTimers();
    const index = make();
    const listener = vi.fn();
    index.subscribe(listener);

    for (let i = 0; i < 5; i++) {
      index.ingest(
        event({
          id: `${i}`.repeat(64).slice(0, 64),
          authorId: VIEWER,
          tags: [["h", "c1"], ["e", "d1".repeat(32), "", "reply"]],
        }),
      );
    }
    // Nothing is published until the debounce elapses.
    expect(index.snapshot()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(index.snapshot()).toHaveLength(1);
  });

  it("returns a stable reference until data changes", () => {
    const index = make();
    index.ingest(
      event({
        id: "s1".repeat(32),
        authorId: VIEWER,
        tags: [["h", "c1"], ["e", "s2".repeat(32), "", "reply"]],
      }),
    );
    index.computeNow();
    const first = index.snapshot();
    index.computeNow();
    expect(index.snapshot()).toBe(first);
  });
});

describe("inbox projection ingestion", () => {
  it("lists a viewer-authored top-level conversation surfaced by the projection", () => {
    const index = make();
    const root = "e1".repeat(32);
    index.ingestInboxItem({
      channelId: "c1",
      messageId: root,
      authorId: VIEWER,
      preview: "a thought",
      createdAt: BASE,
      mentioned: false,
      thread: false,
      unreadCount: 0,
    });
    index.computeNow();
    const [entry] = index.snapshot();
    expect(entry.rootId).toBe(root);
    expect(entry.reasons).toEqual(["started"]);
    expect(entry.replyCount).toBeNull();
    expect(entry.unreadCount).toBeNull();
  });

  it("takes the unread count and reason from a thread item", () => {
    const index = make();
    const root = "e2".repeat(32);
    index.ingestInboxItem({
      channelId: "c1",
      rootId: root,
      messageId: "e3".repeat(32),
      authorId: VIEWER,
      preview: "my reply",
      createdAt: BASE,
      mentioned: false,
      thread: true,
      unreadCount: 4,
    });
    index.computeNow();
    const [entry] = index.snapshot();
    expect(entry.rootId).toBe(root);
    expect(entry.reasons).toEqual(["replied"]);
    expect(entry.unreadCount).toBe(4);
  });
});

describe("channel access", () => {
  it("drops inaccessible channels", () => {
    const index = make({
      channelAccessible: (channelId) => channelId !== "gone",
    });
    index.ingest(
      event({
        id: "g1".repeat(32),
        authorId: VIEWER,
        tags: [["h", "gone"], ["e", "g2".repeat(32), "", "reply"]],
      }),
    );
    index.ingest(
      event({
        id: "k1".repeat(32),
        authorId: VIEWER,
        tags: [["h", "kept"], ["e", "k2".repeat(32), "", "reply"]],
      }),
    );
    index.computeNow();
    expect(ids(index.snapshot())).toEqual(["k2".repeat(32)]);
  });
});
