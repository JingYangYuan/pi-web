import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  isThinkingLevel,
  projectSettingsPath,
  shadowingProjectKeys,
  writeDefaultPreferences,
  type DefaultPreferencesEdit,
} from "@/lib/default-preferences";
import { thinkingLevelChoices } from "@/lib/thinking-levels";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { displaySettingsPath } from "@/lib/enabled-models-runtime";
import { getGlobalSettingsPath, readGlobalSettings } from "@/lib/global-settings-file";
import { resolveVisibleModels } from "@/lib/model-scope";
import { withDeferredProviderModels } from "@/lib/deferred-provider-models";
import { invalidateModelsCache } from "@/lib/models-cache";
import { projectTrustReloadOptions } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

interface DefaultPreferencesRequest {
  cwd?: unknown;
  provider?: unknown;
  modelId?: unknown;
  thinkingLevel?: unknown;
}

/**
 * What the hub last wrote as the host default (`pihubDefaults`), so the panel
 * can say whether the account follows it or has overridden it. The broker owns
 * the key and rewrites it on every sync; a plain Pi Web install has none.
 */
function readHubDefaults(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const written: Record<string, string> = {};
  for (const key of ["defaultProvider", "defaultModel", "defaultThinkingLevel"] as const) {
    const entry = source[key];
    if (typeof entry === "string" && entry) written[key] = entry;
  }
  return Object.keys(written).length > 0 ? written : null;
}

/**
 * The global defaults a new session starts with, read from the file the save
 * writes. `SettingsManager` has no getter for `pihubDefaults`, and the marker
 * must come from the same snapshot as the values it is compared with.
 */
export async function GET() {
  const settingsPath = getGlobalSettingsPath();
  try {
    const view = await readGlobalSettings(settingsPath, (settings) => ({
      defaultProvider: typeof settings.defaultProvider === "string" ? settings.defaultProvider : null,
      defaultModel: typeof settings.defaultModel === "string" ? settings.defaultModel : null,
      defaultThinkingLevel: typeof settings.defaultThinkingLevel === "string" ? settings.defaultThinkingLevel : null,
      hubDefaults: readHubDefaults(settings.pihubDefaults),
    }));
    return Response.json({ ...view, settingsPath: displaySettingsPath(settingsPath) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function parseEdit(body: DefaultPreferencesRequest): DefaultPreferencesEdit | null {
  const edit: DefaultPreferencesEdit = {};
  if (body.provider !== undefined || body.modelId !== undefined) {
    if (typeof body.provider !== "string" || !body.provider) return null;
    if (typeof body.modelId !== "string" || !body.modelId) return null;
    edit.model = { provider: body.provider, modelId: body.modelId };
  }
  if (body.thinkingLevel !== undefined) {
    if (!isThinkingLevel(body.thinkingLevel)) return null;
    edit.thinkingLevel = body.thinkingLevel;
  }
  return edit.model || edit.thinkingLevel ? edit : null;
}

/**
 * Save the model and/or reasoning level new sessions start with.
 *
 * Picking a model for one chat is session-scoped, as in the TUI; this is the
 * explicit "save as default" behind the selectors' star and the Settings panel's
 * card. The cwd decides which project settings could shadow the global value and
 * which models are in scope, so it goes through the same allow-list as
 * `/api/models`. A model saved together with a level it disables is refused
 * (`422`, `supported`), rather than stored and clamped on every session start.
 */
export async function PUT(req: Request) {
  let body: DefaultPreferencesRequest;
  try {
    body = await req.json() as DefaultPreferencesRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const edit = parseEdit(body);
  if (!edit) {
    return Response.json({ error: "Expected provider and modelId, or a valid thinkingLevel" }, { status: 400 });
  }

  const cwd = resolve(typeof body.cwd === "string" && body.cwd ? body.cwd : process.cwd());
  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const agentDir = getAgentDir();
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const { settingsManager } = services;

    const shadowed = shadowingProjectKeys(settingsManager, edit);
    if (shadowed.length > 0) {
      const settingsPath = projectSettingsPath(cwd);
      return Response.json({
        error: `${settingsPath} sets ${shadowed.join(", ")} for this project, so a global default would not apply here.`,
        reason: "project-scope",
        settingsPath,
        keys: shadowed,
      }, { status: 409 });
    }

    if (edit.model) {
      // Only a model the selector can offer is a default that actually takes
      // effect: startup falls back to the first scoped model otherwise.
      const scope = await resolveVisibleModels(withDeferredProviderModels(services.modelRuntime), settingsManager.getEnabledModels());
      const { provider, modelId } = edit.model;
      const model = scope.visible.find((entry) => entry.provider === provider && entry.id === modelId);
      if (!model) {
        return Response.json({ error: `Model not available: ${provider}/${modelId}` }, { status: 404 });
      }
      // The level is saved with the model, so a pair the model cannot do is
      // refused here instead of being clamped away on every session start.
      if (edit.thinkingLevel) {
        const supported = thinkingLevelChoices(model.thinkingLevelMap);
        if (!supported.includes(edit.thinkingLevel)) {
          return Response.json({
            error: supported.length > 0
              ? `${provider}/${modelId} does not support thinking level ${edit.thinkingLevel}. It supports: ${supported.join(", ")}.`
              : `${provider}/${modelId} does not support any thinking level.`,
            reason: "thinking-level-unsupported",
            supported,
          }, { status: 422 });
        }
      }
    }

    await writeDefaultPreferences(settingsManager, edit);
    invalidateModelsCache();
    return Response.json({
      ok: true,
      ...(edit.model ? { defaultModel: edit.model } : {}),
      ...(edit.thinkingLevel ? { defaultThinkingLevel: edit.thinkingLevel } : {}),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
