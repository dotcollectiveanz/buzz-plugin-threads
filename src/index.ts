/**
 * Threads — a Slack-style threads experience for Buzz desktop.
 *
 * Entries: this plugin is one self-contained module. Module top level is pure;
 * all work happens inside `apply`, and everything it owns is released through
 * `ctx.effect`.
 */
import { createThreadsRuntime } from "./session";
import { createThreadsBadge } from "./badge";
import { createThreadsPage } from "./page/ThreadsPage";
import { isThreadsRoute } from "./page/route";
import type { BuzzContext } from "./buzz-types";

/**
 * Nav icon: a monochrome chat bubble with two text lines, painted in
 * `currentColor` so the host draws it as a theme-aware mask.
 */
const ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik00IDUuNUEyLjUgMi41IDAgMCAxIDYuNSAzaDExQTIuNSAyLjUgMCAwIDEgMjAgNS41djdBMi41IDIuNSAwIDAgMSAxNy41IDE1SDEwbC00IDN2LTNINi41QTIuNSAyLjUgMCAwIDEgNCAxMi41eiIvPjxwYXRoIGQ9Ik04IDhoOE04IDExaDUiLz48L3N2Zz4=";

export const inject = ["react", "relay", "pages", "navigation", "conversation"];

export function apply(ctx: BuzzContext): void {
  const React = ctx.react;

  ctx.effect(() => {
    const runtime = createThreadsRuntime(ctx);

    ctx.pages.register({
      id: "threads",
      title: "Threads",
      component: createThreadsPage(React, ctx, runtime),
      layout: "workspace",
      primary: true,
      icon: ICON,
      badge: createThreadsBadge(React, runtime),
      route: { version: 1, validate: isThreadsRoute },
    });

    return () => runtime.dispose();
  });
}
