/**
 * Pure pieces of Settings › Models › New session defaults.
 *
 * The card reads `GET /api/models/default` and `GET /api/models`, then saves
 * both values in one `PUT /api/models/default`. Keeping the decisions here
 * (which level a model offers, what the controls start on, what the refused
 * request said) lets them be tested without a browser.
 */

/**
 * The reasoning levels a model offers; see `lib/thinking-levels.ts`, which the
 * route uses too, so the panel and the save check agree.
 */
export { isThinkingLevel, THINKING_LEVELS, thinkingLevelChoices } from "@/lib/thinking-levels";
export type { ThinkingLevel } from "@/lib/thinking-levels";

import { isThinkingLevel, type ThinkingLevel } from "@/lib/thinking-levels";

export interface DefaultModelRef {
  provider: string;
  modelId: string;
}

/** The values the save button writes. */
export interface DefaultSelection extends DefaultModelRef {
  thinkingLevel: ThinkingLevel;
}

/** `GET /api/models/default`: the saved values plus what the hub last wrote. */
export interface DefaultPreferencesView {
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: string | null;
  /**
   * `pihubDefaults`, the host default the hub regenerated on its last sync.
   * Absent on a plain Pi Web install, which has no host to follow.
   */
  hubDefaults: { defaultProvider?: string; defaultThinkingLevel?: string; defaultModel?: string } | null;
  settingsPath?: string;
}

/** The key `GET /api/models` uses for a model's level map and level list. */
export function modelKey(model: DefaultModelRef): string {
  return `${model.provider}:${model.modelId}`;
}

function isListed(model: DefaultModelRef | null, available: readonly DefaultModelRef[]): model is DefaultModelRef {
  return model !== null && available.some((entry) => entry.provider === model.provider && entry.modelId === model.modelId);
}

/**
 * The model the card starts on: the saved default while the selector still
 * offers it, else the model a new session would actually start with, else the
 * first one listed.
 *
 * A saved model that is no longer visible (the account lost access to it, or
 * its provider was removed) is skipped rather than preselected: the route
 * refuses a model outside the scope, so offering it would fail on save.
 */
export function resolveDefaultModel(
  saved: DefaultPreferencesView | null,
  effective: DefaultModelRef | null,
  available: readonly DefaultModelRef[],
): DefaultModelRef | null {
  const savedModel = saved?.defaultProvider && saved.defaultModel
    ? { provider: saved.defaultProvider, modelId: saved.defaultModel }
    : null;
  if (isListed(savedModel, available)) return savedModel;
  if (isListed(effective, available)) return effective;
  return available[0] ?? null;
}

/**
 * The reasoning level the card starts on: the saved default, else the level a
 * new session would start with, else the model's first level.
 */
export function resolveDefaultLevel(
  choices: readonly ThinkingLevel[],
  savedLevel: string | null | undefined,
  effectiveLevel: string | null | undefined,
): ThinkingLevel | null {
  for (const candidate of [savedLevel, effectiveLevel]) {
    if (isThinkingLevel(candidate) && choices.includes(candidate)) return candidate;
  }
  return choices[0] ?? null;
}

/**
 * True while the account follows the host default: every value the hub wrote
 * is still the file's value, so nothing has been overridden yet.
 */
export function followsHostDefaults(saved: DefaultPreferencesView | null): boolean {
  const host = saved?.hubDefaults;
  if (!host) return false;
  return (saved?.defaultProvider ?? null) === (host.defaultProvider ?? null)
    && (saved?.defaultModel ?? null) === (host.defaultModel ?? null)
    && (saved?.defaultThinkingLevel ?? null) === (host.defaultThinkingLevel ?? null);
}

/**
 * The body of `PUT /api/models/default`. Both values go together: the saved
 * level is validated against the saved model, and the card never saves a pair
 * the route would refuse as a mismatch.
 */
export function defaultPreferencesRequest(
  cwd: string | null | undefined,
  selection: DefaultSelection,
): Record<string, string> {
  return {
    ...(cwd ? { cwd } : {}),
    provider: selection.provider,
    modelId: selection.modelId,
    thinkingLevel: selection.thinkingLevel,
  };
}

export interface DefaultPreferencesFailure {
  /** The route's own message; it already names the file or the supported levels. */
  message: string;
  /** `409 reason: "project-scope"`: the project file that wins over the global value. */
  settingsPath?: string;
  /** `422 reason: "thinking-level-unsupported"`: the levels the model does accept. */
  supported?: ThinkingLevel[];
}

/** A refused save, as the line under the card shows it. */
export function defaultPreferencesFailure(
  status: number,
  payload: unknown,
): DefaultPreferencesFailure {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const error = typeof record.error === "string" && record.error.trim() ? record.error : `HTTP ${status}`;
  const supported = Array.isArray(record.supported) ? record.supported.filter(isThinkingLevel) : [];
  return {
    message: error,
    ...(typeof record.settingsPath === "string" && record.settingsPath
      ? { settingsPath: record.settingsPath }
      : {}),
    ...(supported.length > 0 ? { supported } : {}),
  };
}
