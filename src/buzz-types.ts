/**
 * Local structural mirrors of the Buzz plugin API shapes this plugin uses.
 *
 * The API is a preview and there is no published SDK: external plugins import
 * types only and never at runtime. These types are deliberately structural so
 * the built `plugin.js` has no imports. Each is annotated with the Buzz source
 * it mirrors (checked against buzz-app @ 0c66ed0).
 */

import type * as ReactNS from "react";
import type { InboxItemLike } from "./thread-index";

export type Unsubscribe = () => void;

/** Mirrors `features/navigation/targets.ts` `OpenTarget` (subset we emit). */
export type OpenTarget =
  | { version: 1; kind: "home" }
  | { version: 1; kind: "settings"; section?: string }
  | {
      version: 1;
      kind: "plugin";
      pluginId: string;
      pageId?: string;
      params?: Readonly<Record<string, string>>;
    }
  | {
      version: 1;
      kind: "page";
      pluginId: string;
      pageId: string;
      route?: { version: number; params: unknown };
    }
  | {
      version: 1;
      kind: "conversation";
      scope: { viewer: string; communityOrigin: string };
      channelId: string;
      messageId?: string;
      threadRootId?: string;
      context?: "channel";
    };

/** Mirrors `features/navigation/service.ts` `PageNavigation` (subset). */
export type PageNavigationLike = {
  target?: OpenTarget;
};

/** Mirrors `features/pages/service.ts` `Page`/`PageProps` (subset). */
export type PagePropsLike = {
  navigation?: PageNavigationLike;
};

export type PageLike = {
  id: string;
  title: string;
  component: (props: PagePropsLike) => ReactNS.ReactNode;
  primary?: boolean;
  layout?: "document" | "workspace";
  placement?: "sidebar" | "dock";
  route?: {
    version: number;
    validate: (params: unknown) => boolean;
  };
  /** `data:image/...` URL; a monochrome SVG is drawn as a theme-aware mask. */
  icon?: string;
  /** Navigation count/mark, rendered by the host in a contribution boundary. */
  badge?: ReactNS.ComponentType;
};

/** Mirrors `features/relay/service.ts` `RelaySnapshot` (subset). */
export type RelaySnapshotLike = {
  status: "disconnected" | "connecting" | "ready" | "error";
  generation: number;
  scope?: string;
  viewer?: string;
  session: RelaySessionLike;
};

export type ReadFilterLike = {
  kinds?: readonly number[];
  authors?: readonly string[];
  "#h"?: readonly string[];
  "#p"?: readonly string[];
  "#e"?: readonly string[];
  limit?: number;
  since?: number;
  until?: number;
};

/** Mirrors `features/relay/events.ts` `EventData`. */
export type EventDataLike = {
  id: string;
  kind: number;
  created_at: number;
  pubkey: string;
  content: string;
  tags: readonly (readonly string[])[];
};

/** Mirrors an owned `session.observe(...)` view. */
export type ObservedViewLike = {
  snapshot(): { status: string; events: readonly EventDataLike[]; error?: string };
  subscribe(listener: () => void): Unsubscribe;
  refresh(): Promise<unknown>;
  dispose(): void;
};

export type ChannelSummaryLike = {
  id: string;
  name: string;
  archived?: boolean;
  hidden?: boolean;
  channelType?: string;
};

/** Mirrors `features/relay/read-state-model.ts` `ReadTarget` (subset). */
export type EffectiveTargetLike =
  | { kind: "channel"; channelId: string }
  | { kind: "thread"; channelId: string; rootId: string }
  | { kind: "message"; channelId: string; messageId: string };

/** Mirrors `features/relay/unread.ts` `ReadingHandle` (subset). */
export type ReadingHandleLike = {
  observe(messageIds: readonly string[]): Promise<void>;
  dispose(): void;
};

/** Mirrors `features/relay/unread.ts` `UnreadCapability` (subset). */
export type UnreadLike = {
  snapshot(target: EffectiveTargetLike): {
    observedCount: number | null;
    attentionCount: number | null;
  };
  subscribe(target: EffectiveTargetLike, listener: () => void): Unsubscribe;
  following(channelId: string, rootId: string): boolean;
  ensure(): Promise<void>;
  inbox(): { items: readonly InboxItemLike[] };
  subscribeInbox(listener: () => void): Unsubscribe;
  reading(channelId: string, rootId?: string): ReadingHandleLike;
};

/** Mirrors `features/relay/contracts.ts` `ChannelMessage` (loose). */
export type ChannelMessageLike = {
  id: string;
  channelId: string;
  authorId: string;
  createdAt: number;
  [key: string]: unknown;
};

/** Mirrors `features/relay/contracts.ts` `Profile` (loose). */
export type ProfileLike = {
  name?: string;
  picture?: string;
  isAgent?: boolean;
  [key: string]: unknown;
};

export type ProfileQueriesLike = {
  snapshot(): ReadonlyMap<string, ProfileLike>;
  subscribe(listener: () => void): Unsubscribe;
};

/** Mirrors `features/relay/threads.ts` `ThreadSnapshot` (subset). */
export type ThreadSnapshotLike = {
  status: "idle" | "loading" | "ready" | "error";
  root: ChannelMessageLike | undefined;
  replies: readonly ChannelMessageLike[];
  error: string | undefined;
  canLoadMore: boolean;
  limited: boolean;
};

/** Mirrors `features/relay/threads.ts` `ThreadView`. */
export type ThreadViewLike = {
  snapshot(): ThreadSnapshotLike;
  subscribe(listener: () => void): Unsubscribe;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  dispose(): void;
};

/** Mirrors `features/relay/session.ts` `RelaySession` (subset we use). */
export type RelaySessionLike = {
  observe(filters: readonly ReadFilterLike[]): ObservedViewLike;
  thread(channelId: string, messageId: string): ThreadViewLike;
  channels: {
    list(): { channels: readonly ChannelSummaryLike[] };
    subscribeList?(listener: () => void): Unsubscribe;
  };
  unread: UnreadLike;
  profiles: ProfileQueriesLike;
  media(url: string, size?: "small"): string | undefined;
  messages: { retry(id: string): void };
};

/** Mirrors `features/conversation/ConversationHost.tsx` `ConversationInteractions`. */
export type ConversationInteractionsLike = {
  onOpenLink(url: string, origin?: { rootId: string }): boolean;
  canOpenLink(target: string): boolean;
};

export type MessageLikeProps = {
  key?: string;
  row: ChannelMessageLike;
  profile?: ProfileLike | undefined;
  media(url: string, size?: "small"): string | undefined;
  onOpenLink(url: string, origin?: { rootId: string }): boolean;
  canOpenLink?: (target: string) => boolean;
  day: boolean;
  retry: ((id: string) => void) | undefined;
  session?: RelaySessionLike | undefined;
  scope?: string | undefined;
};

export type ComposerLikeProps = {
  session: RelaySessionLike;
  scope: string;
  channelId: string;
  channelName: string;
  threadRootId?: string;
  editMessages?: readonly ChannelMessageLike[];
  onOpenLink?: (url: string, origin?: { rootId: string }) => boolean;
  canOpenLink?: (target: string) => boolean;
};

export type ConversationLikeProps = {
  session: RelaySessionLike;
  scope: string;
  channelId: string;
  channelName?: string;
  threadId?: string;
  children(interactions: ConversationInteractionsLike): ReactNS.ReactNode;
};

export type PageTabTargetLike = {
  channelId: string;
  threadId?: string;
  messageId?: string;
};

/** Mirrors `features/conversation/contracts.ts` `PageTabsProps`. */
export type PageTabsLikeProps = {
  id: string;
  session: RelaySessionLike;
  scope: string;
  label: string;
  children(
    open: (target: PageTabTargetLike) => boolean,
    close: (target: PageTabTargetLike) => boolean,
    isOpen: (target: PageTabTargetLike) => boolean,
  ): ReactNS.ReactNode;
};

/** Mirrors `features/conversation/service.tsx` `Conversation.ui` (subset). */
export type ConversationUiLike = {
  Conversation: (props: ConversationLikeProps) => ReactNS.ReactNode;
  Composer: (props: ComposerLikeProps) => ReactNS.ReactNode;
  Message: (props: MessageLikeProps) => ReactNS.ReactNode;
  /** Present only while a plugin provides the tab workspace (Channels). */
  Tabs?: ((props: PageTabsLikeProps) => ReactNS.ReactNode) | undefined;
};

/** Mirrors `plugins/api.ts` `apply(ctx)` context (subset we depend on). */
export type BuzzContext = {
  react: typeof ReactNS;
  relay: {
    snapshot(): RelaySnapshotLike;
    subscribe(listener: () => void): Unsubscribe;
  };
  pages: { register(page: PageLike): void };
  navigation: { open(target: OpenTarget): Promise<{ status: string }> };
  conversation: { ui: ConversationUiLike };
  effect(effect: () => (() => void) | void): void;
};
