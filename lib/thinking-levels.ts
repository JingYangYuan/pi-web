import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type { ThinkingLevel };

/**
 * pi's reasoning levels and what a model makes of them.
 *
 * `thinkingLevelMap[level] === null` is pi's way of saying the model cannot do
 * that level; every other level stays, including `xhigh` and `max`, which a
 * provider maps to its own effort name. A model without a map takes the full
 * set. Shared by the settings routes and the Settings panel, which offer the
 * same choices.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

export function thinkingLevelChoices(
  levelMap?: Record<string, string | null> | null,
): ThinkingLevel[] {
  return THINKING_LEVELS.filter((level) => levelMap?.[level] !== null);
}
