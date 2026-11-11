/**
 * The Threads page route: `{ channel?, root? }`.
 *
 * Mirrors `features/navigation/targets.ts` (`parseOpenTarget` for `page`/`plugin`
 * targets) and the bundled Inbox route contract.
 */
import type { OpenTarget } from "../buzz-types";

export type ThreadsRoute = {
  channel?: string;
  root?: string;
};

const CHANNEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;
const ROOT_PATTERN = /^[a-fA-F0-9]{64}$/;

function readParams(value: unknown): ThreadsRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const route: ThreadsRoute = {};
  if (typeof record.channel === "string" && CHANNEL_PATTERN.test(record.channel))
    route.channel = record.channel;
  if (typeof record.root === "string" && ROOT_PATTERN.test(record.root))
    route.root = record.root.toLowerCase();
  return route;
}

/** `Page.route.validate`: synchronous, side-effect-free. */
export function isThreadsRoute(params: unknown): boolean {
  if (params === undefined) return true;
  if (!params || typeof params !== "object" || Array.isArray(params))
    return false;
  const record = params as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value !== "string") return false;
    if (key === "channel") {
      if (!CHANNEL_PATTERN.test(value)) return false;
    } else if (key === "root") {
      if (!ROOT_PATTERN.test(value)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** The route an open carries, if any. A plain "view all" open has none. */
export function routeOf(target: OpenTarget | undefined): ThreadsRoute {
  if (!target) return {};
  if (target.kind === "page") {
    const route = target.route;
    return route && route.version === 1 ? readParams(route.params) : {};
  }
  if (target.kind === "plugin") return readParams(target.params);
  return {};
}
