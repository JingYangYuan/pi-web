import { existsSync, readFileSync } from "node:fs";
import { getGlobalSettingsPath } from "./global-settings-file";

/**
 * The package sources the hub administrator owns in this account's
 * `settings.json`.
 *
 * The hub's credential broker regenerates that file on every sync and records
 * the sources it put there in `pihubPackages`; whatever else the account has in
 * `packages` is its own addition, which the broker keeps. The marker exists so
 * the broker can tell the two apart, and Pi Web reads the same key to leave the
 * admin's packages alone: removing one here would only make the next sync point
 * at a module that is no longer installed.
 *
 * A missing or unreadable file means "nothing is marked": the panel is a
 * management aid, and a settings file pi itself cannot read has larger problems.
 */
export function hubManagedSources(settingsPath = getGlobalSettingsPath()): Set<string> {
  if (!existsSync(settingsPath)) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return new Set();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Set();
  const raw = (parsed as { pihubPackages?: unknown }).pihubPackages;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0));
}
