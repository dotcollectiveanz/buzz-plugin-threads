/**
 * The Threads sidebar section.
 *
 * Registered through the optional `sidebarSections` service, read with
 * `ctx.reflect.get("sidebarSections")` so the plugin still activates on hosts
 * that do not provide it (the page then registers as `primary: true`).
 */
import { MAX_ROWS } from "./constants";
import type {
  BuzzContext,
  SidebarSectionRowLike,
  SidebarSectionsLike,
  Unsubscribe,
} from "./buzz-types";
import { threadTarget, type ThreadsRuntime } from "./session";
import type * as ReactNS from "react";

export type ThreadsSidebar = {
  register(): void;
  dispose(): void;
};

export function createThreadsSidebar(
  React: typeof ReactNS,
  ctx: BuzzContext,
  runtime: ThreadsRuntime,
): ThreadsSidebar {
  const targets = new Map<string, { channelId: string; rootId: string }>();
  const listeners = new Set<() => void>();
  let rows: readonly SidebarSectionRowLike[] = Object.freeze([]);
  let stop: Unsubscribe | undefined;

  function rebuild() {
    const { entries } = runtime.getSnapshot();
    targets.clear();
    const next = entries.slice(0, MAX_ROWS).map((entry) => {
      const id = `${entry.channelId}:${entry.rootId}`;
      targets.set(id, { channelId: entry.channelId, rootId: entry.rootId });
      const name = entry.channelName || entry.channelId;
      const label = entry.rootPreview
        ? `#${name} · ${entry.rootPreview}`
        : `#${name}`;
      const count =
        entry.unreadCount !== null && entry.unreadCount > 0
          ? entry.unreadCount
          : undefined;
      return Object.freeze({
        id,
        label,
        ...(count !== undefined ? { count } : {}),
      });
    });
    rows = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): Unsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function select(row: SidebarSectionRowLike) {
    const target = targets.get(row.id);
    return target
      ? threadTarget(target.channelId, target.rootId)
      : threadTarget();
  }

  return {
    register() {
      const sections = ctx.reflect.get(
        "sidebarSections",
      ) as SidebarSectionsLike | undefined;
      if (!sections || typeof sections.register !== "function") return;
      const viewAll = {
        id: "view-all",
        label: "View all threads",
        icon: React.createElement("span", { "aria-hidden": true }, "≡"),
        onSelect: () => runtime.openAll(),
      };
      sections.register({
        version: 1,
        id: "threads",
        title: "Threads",
        icon: "#",
        rows: { snapshot: () => rows, subscribe },
        select,
        actions: [viewAll],
      });
      stop = runtime.subscribe(rebuild);
      rebuild();
    },
    dispose() {
      stop?.();
      stop = undefined;
      listeners.clear();
    },
  };
}
