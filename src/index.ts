/**
 * Threads — a Slack-style threads experience for Buzz desktop.
 *
 * Entries: this plugin is one self-contained module. Module top level is pure;
 * all work happens inside `apply`, and everything it owns is released through
 * `ctx.effect`.
 */
import { createThreadsRuntime } from "./session";
import { createThreadsSidebar } from "./sidebar";
import { createThreadsPage } from "./page/ThreadsPage";
import { isThreadsRoute } from "./page/route";
import type { BuzzContext, SidebarSectionsLike } from "./buzz-types";

// Declare every required service; optional ones (`sidebarSections`) are read
// with ctx.reflect instead of being listed here.
export const inject = ["react", "relay", "pages", "navigation"];

export function apply(ctx: BuzzContext): void {
  const React = ctx.react;

  ctx.effect(() => {
    const runtime = createThreadsRuntime(ctx);

    const sections = ctx.reflect.get("sidebarSections") as
      | SidebarSectionsLike
      | undefined;
    const hasSidebar =
      !!sections && typeof sections.register === "function";

    ctx.pages.register({
      id: "threads",
      title: "Threads",
      component: createThreadsPage(React, runtime),
      layout: "workspace",
      // Fallback only: without a sidebar section the page needs a nav entry.
      primary: !hasSidebar,
      route: { version: 1, validate: isThreadsRoute },
    });

    const sidebar = hasSidebar
      ? createThreadsSidebar(React, ctx, runtime)
      : undefined;
    sidebar?.register();

    return () => {
      sidebar?.dispose();
      runtime.dispose();
    };
  });
}
