/**
 * Local structural mirrors of the Buzz plugin API shapes this plugin uses.
 *
 * The API is a preview and there is no published SDK: external plugins import
 * types only and never at runtime. These types are deliberately structural so
 * the built `plugin.js` has no imports. Each is annotated with the Buzz source
 * it mirrors (checked against buzz-app @ 0c66ed0).
 */

import type * as ReactNS from "react";
import type { InboxItemLike, RelayEventLike } from "./thread-index";

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
  route?: {
    version: number;
    validate: (params: unknown) => boolean;
  };
  icon?: string;
};

/** Mirrors `features/channel-navigation/sidebar-sections-service.ts`. */
export type SidebarSectionRowLike = {
  id: string;
  label: string;
  icon?: ReactNS.ReactNode;
  badge?: string;
  count?: number;
  status?: string;
};

export type SidebarSectionActionLike = {
  id: string;
  label: string;
  icon: ReactNS.ReactElement;
  onSelect: () => void | Promise<void>;
};

export type SidebarSectionContributionLike = {
  version: 1;
  id: string;
  title: string;
  icon: ReactNS.ReactNode;
  rows: {
    snapshot: () => readonly SidebarSectionRowLike[];
    subscribe: (listener: () => void) => Unsubscribe;
  };
  select: (row: SidebarSectionRowLike) => OpenTarget;
  actions?: readonly SidebarSectionActionLike[];
};

export type SidebarSectionsLike = {
  version: 1;
  register(section: SidebarSectionContributionLike): void;
  snapshot(): readonly unknown[];
  subscribe(listener: () => void): Unsubscribe;
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
};

/** Mirrors `features/relay/session.ts` `RelaySession` (subset). */
export type RelaySessionLike = {
  observe(filters: readonly ReadFilterLike[]): ObservedViewLike;
  channels: { list(): { channels: readonly ChannelSummaryLike[] } };
  unread: UnreadLike;
};

export type { InboxItemLike, RelayEventLike };

/** Mirrors `plugins/api.ts` `apply(ctx)` context (subset we depend on). */
export type BuzzContext = {
  react: typeof ReactNS;
  relay: {
    snapshot(): RelaySnapshotLike;
    subscribe(listener: () => void): Unsubscribe;
  };
  pages: { register(page: PageLike): void };
  navigation: { open(target: OpenTarget): Promise<{ status: string }> };
  reflect: { get(name: string): unknown };
  effect(effect: () => (() => void) | void): void;
};
