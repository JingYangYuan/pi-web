"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "./SettingsUi";
import {
  defaultPreferencesFailure,
  defaultPreferencesRequest,
  followsHostDefaults,
  modelKey,
  resolveDefaultLevel,
  resolveDefaultModel,
  thinkingLevelChoices,
  type DefaultModelRef,
  type DefaultPreferencesFailure,
  type DefaultPreferencesView,
  type DefaultSelection,
  type ThinkingLevel,
} from "./default-model-helpers";

interface ModelsResponse {
  modelList?: { id: string; name: string; provider: string; providerName: string }[];
  defaultModel?: { provider: string; modelId: string } | null;
  defaultThinkingLevel?: string | null;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  error?: string;
}

/** The reasoning menu's own words for a level ("High reasoning", "High 推理"). */
function thinkingLevelLabel(level: ThinkingLevel, t: (key: string) => string): string {
  return t(`chat.thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`);
}

/**
 * Settings › Models › New session defaults: the model and reasoning level new
 * chats start with, saved in one click.
 *
 * Saving is the same write as the selectors' star (pi's Ctrl+S in `/model` and
 * `/thinking`), and it changes only what a *new* session starts with; the open
 * chat keeps its own model and level. The card says so, because a save that
 * appears to do nothing to the visible chat is otherwise easy to miss.
 */
export function DefaultModelSection({ cwd }: { cwd?: string | null }) {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [saved, setSaved] = useState<DefaultPreferencesView | null>(null);
  const [selection, setSelection] = useState<DefaultSelection | null>(null);
  const [touched, setTouched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [failure, setFailure] = useState<DefaultPreferencesFailure | null>(null);

  const reloadPreferences = useCallback(async () => {
    const res = await fetch("/api/models/default");
    const body = await res.json() as DefaultPreferencesView & { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
    setSaved(body);
    return body;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    setLoadError(null);
    Promise.all([
      fetch(`/api/models${query}`, { signal: controller.signal }).then(async (res) => {
        const body = await res.json() as ModelsResponse & { error?: string };
        if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body;
      }),
      reloadPreferences(),
    ])
      .then(([modelData, preferences]) => {
        if (controller.signal.aborted) return;
        setModels(modelData);
        setSaved(preferences);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [cwd, reloadPreferences]);

  const available = useMemo<DefaultModelRef[]>(
    () => (models?.modelList ?? []).map((model) => ({ provider: model.provider, modelId: model.id })),
    [models],
  );

  const levelMap = useCallback(
    (model: DefaultModelRef | null) => (
      model ? models?.thinkingLevelMaps?.[modelKey(model)] : undefined
    ),
    [models],
  );

  const choices = useMemo<ThinkingLevel[]>(
    () => thinkingLevelChoices(levelMap(selection)),
    [levelMap, selection],
  );

  // The controls open on the saved default; while the user has not touched
  // them they follow a reload (another tab, a save) instead of freezing.
  useEffect(() => {
    if (touched || !models) return;
    const model = resolveDefaultModel(saved, models.defaultModel ?? null, available);
    if (!model) return;
    const levels = thinkingLevelChoices(levelMap(model));
    const level = resolveDefaultLevel(levels, saved?.defaultThinkingLevel, models.defaultThinkingLevel);
    setSelection(level ? { ...model, thinkingLevel: level } : null);
  }, [available, levelMap, models, saved, touched]);

  const selectModel = (model: DefaultModelRef) => {
    const levels = thinkingLevelChoices(levelMap(model));
    // Keep the level when the new model offers it; otherwise take its first.
    const keep = selection && levels.includes(selection.thinkingLevel) ? selection.thinkingLevel : levels[0];
    setTouched(true);
    setSavedOk(false);
    setFailure(null);
    setSelection(keep ? { ...model, thinkingLevel: keep } : null);
  };

  const save = useCallback(async () => {
    if (!selection) return;
    setSaving(true);
    setSavedOk(false);
    setFailure(null);
    try {
      const res = await fetch("/api/models/default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaultPreferencesRequest(cwd, selection)),
      });
      if (!res.ok) {
        let payload: unknown = null;
        try {
          payload = await res.json();
        } catch {
          // A non-JSON refusal falls back to the HTTP status.
        }
        setFailure(defaultPreferencesFailure(res.status, payload));
        return;
      }
      const preferences = await reloadPreferences();
      setSaved(preferences);
      setSavedOk(true);
      setTouched(false);
      // Report what reached the file, not the draft that was sent.
      const levels = thinkingLevelChoices(levelMap(selection));
      const level = resolveDefaultLevel(levels, preferences.defaultThinkingLevel, selection.thinkingLevel);
      if (level) setSelection({ ...selection, thinkingLevel: level });
    } catch (error) {
      setFailure({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }, [cwd, levelMap, reloadPreferences, selection]);

  if (loadError) {
    return (
      <div className="new-session-defaults">
        <span className="new-session-defaults-error">{t("models.defaultsLoadFailed", { error: loadError })}</span>
      </div>
    );
  }
  if (!models || !selection) return null;

  const providerNames = new Map((models.modelList ?? []).map((model) => [model.provider, model.providerName]));
  const groupOrder: string[] = [];
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const model of models.modelList ?? []) {
    if (!groups.has(model.provider)) {
      groups.set(model.provider, []);
      groupOrder.push(model.provider);
    }
    groups.get(model.provider)?.push({ id: model.id, name: model.name });
  }

  const following = followsHostDefaults(saved);
  const currentModel = selection.provider && selection.modelId
    ? `${selection.provider}/${selection.modelId}`
    : "—";
  const levels = choices;
  const levelLabel = thinkingLevelLabel(selection.thinkingLevel, t);

  return (
    <section className="new-session-defaults" aria-label={t("models.defaultsTitle")}>
      <div className="new-session-defaults-head">
        <span className="new-session-defaults-title">{t("models.defaultsTitle")}</span>
        <span className="new-session-defaults-note">{t("models.defaultsDescription")}</span>
      </div>

      <div className="new-session-defaults-controls">
        <label className="new-session-defaults-field">
          <span className="new-session-defaults-label">{t("models.defaultsModel")}</span>
          <select
            className="new-session-defaults-select"
            aria-label={t("models.defaultsModel")}
            value={`${selection.provider}/${selection.modelId}`}
            disabled={saving}
            onChange={(event) => {
              const [provider, ...rest] = event.target.value.split("/");
              const modelId = rest.join("/");
              if (provider && modelId) selectModel({ provider, modelId });
            }}
          >
            {groupOrder.map((provider) => (
              <optgroup key={provider} label={providerNames.get(provider) || provider}>
                {(groups.get(provider) ?? []).map((model) => (
                  <option key={model.id} value={`${provider}/${model.id}`}>{model.name || model.id}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="new-session-defaults-field">
          <span className="new-session-defaults-label">{t("models.defaultsThinking")}</span>
          <select
            className="new-session-defaults-select"
            aria-label={t("models.defaultsThinking")}
            value={selection.thinkingLevel}
            disabled={saving || levels.length < 2}
            onChange={(event) => {
              setTouched(true);
              setSavedOk(false);
              setFailure(null);
              setSelection({ ...selection, thinkingLevel: event.target.value as ThinkingLevel });
            }}
          >
            {levels.map((level) => (
              <option key={level} value={level}>{thinkingLevelLabel(level, t)}</option>
            ))}
          </select>
        </label>

        <ConfigButton
          variant="primary"
          size="small"
          className="new-session-defaults-save"
          onClick={save}
          disabled={saving}
        >
          {saving ? t("i18n.saving") : t("models.defaultsSave")}
        </ConfigButton>
      </div>

      <div className="new-session-defaults-status" aria-live="polite">
        <span className="new-session-defaults-current" title={saved?.settingsPath}>
          {following
            ? t("models.defaultsFollowingHost", { model: currentModel, level: levelLabel })
            : t("models.defaultsCurrent", { model: currentModel, level: levelLabel })}
        </span>
        {failure && (
          <span className="new-session-defaults-error">
            {failure.message}
            {failure.supported && failure.supported.length > 0 && (
              <span className="new-session-defaults-supported">
                {t("models.defaultsSupported", { levels: failure.supported.join(", ") })}
              </span>
            )}
          </span>
        )}
        {savedOk && !failure && (
          <span className="new-session-defaults-ok">{t("models.defaultsSaved")}</span>
        )}
      </div>
    </section>
  );
}
