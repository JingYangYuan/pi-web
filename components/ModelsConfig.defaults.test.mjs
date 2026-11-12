import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  defaultPreferencesFailure,
  defaultPreferencesRequest,
  followsHostDefaults,
  resolveDefaultLevel,
  resolveDefaultModel,
  thinkingLevelChoices,
} = await jiti.import("./default-model-helpers.ts");

const acmeOne = { provider: "acme", modelId: "one" };
const acmeTwo = { provider: "acme", modelId: "two" };

function saved(overrides = {}) {
  return {
    defaultProvider: null,
    defaultModel: null,
    defaultThinkingLevel: null,
    hubDefaults: null,
    ...overrides,
  };
}

test("a model's level map hides only the levels it disables", () => {
  assert.deepEqual(
    thinkingLevelChoices({ high: null, xhigh: null }),
    ["off", "minimal", "low", "medium", "max"],
  );
  // A remapping keeps the level; only an explicit null removes it.
  assert.deepEqual(
    thinkingLevelChoices({ max: "ultra", xhigh: null }),
    ["off", "minimal", "low", "medium", "high", "max"],
  );
});

test("a model without a level map offers every level", () => {
  const all = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  assert.deepEqual(thinkingLevelChoices(undefined), all);
  assert.deepEqual(thinkingLevelChoices(null), all);
  assert.deepEqual(thinkingLevelChoices({}), all);
});

test("the model control opens on the saved default while the list still offers it", () => {
  assert.deepEqual(
    resolveDefaultModel(saved({ defaultProvider: "acme", defaultModel: "two" }), acmeOne, [acmeOne, acmeTwo]),
    acmeTwo,
  );
});

test("a saved model the selector no longer offers is not preselected", () => {
  // Saving it would be refused (it is outside the resolved scope), so the
  // control falls back to what a new session would really start with.
  const savedGone = saved({ defaultProvider: "acme", defaultModel: "gone" });
  assert.deepEqual(resolveDefaultModel(savedGone, acmeTwo, [acmeOne, acmeTwo]), acmeTwo);
  assert.equal(resolveDefaultModel(savedGone, null, [acmeOne]), acmeOne);
  assert.deepEqual(resolveDefaultModel(null, null, [acmeOne, acmeTwo]), acmeOne);
  assert.equal(resolveDefaultModel(null, null, []), null);
});

test("the level control keeps the saved level when the model offers it", () => {
  const levels = ["off", "minimal", "low", "medium", "max"];
  assert.equal(resolveDefaultLevel(levels, "low", "medium"), "low");
  // A saved level the model has since dropped falls back to the session default.
  assert.equal(resolveDefaultLevel(levels, "high", "medium"), "medium");
  assert.equal(resolveDefaultLevel(levels, "high", "xhigh"), "off");
  assert.equal(resolveDefaultLevel([], "low", "low"), null);
});

test("the card follows the host default until a value is overridden", () => {
  const hostDefaults = { defaultProvider: "acme", defaultModel: "one", defaultThinkingLevel: "low" };
  assert.equal(
    followsHostDefaults(saved({ defaultProvider: "acme", defaultModel: "one", defaultThinkingLevel: "low", hubDefaults: hostDefaults })),
    true,
  );
  assert.equal(
    followsHostDefaults(saved({ defaultProvider: "acme", defaultModel: "one", defaultThinkingLevel: "medium", hubDefaults: hostDefaults })),
    false,
  );
  assert.equal(
    followsHostDefaults(saved({ defaultProvider: "acme", defaultModel: "two", defaultThinkingLevel: "low", hubDefaults: hostDefaults })),
    false,
  );
  // Without a host marker (a plain Pi Web install) there is nothing to follow.
  assert.equal(followsHostDefaults(saved()), false);
});

test("saving sends the model and level together, with the project's cwd", () => {
  assert.deepEqual(
    defaultPreferencesRequest("/work/app", { ...acmeOne, thinkingLevel: "low" }),
    { cwd: "/work/app", provider: "acme", modelId: "one", thinkingLevel: "low" },
  );
  // No cwd (no project selected): the route resolves its own, so the key is omitted.
  assert.deepEqual(
    defaultPreferencesRequest(null, { ...acmeOne, thinkingLevel: "low" }),
    { provider: "acme", modelId: "one", thinkingLevel: "low" },
  );
});

test("a refused save keeps the route's message and what it named", () => {
  const projectScoped = defaultPreferencesFailure(409, {
    error: "/work/app/.pi/settings.json sets defaultModel for this project, so a global default would not apply here.",
    reason: "project-scope",
    settingsPath: "/work/app/.pi/settings.json",
    keys: ["defaultModel"],
  });
  assert.equal(projectScoped.settingsPath, "/work/app/.pi/settings.json");
  assert.match(projectScoped.message, /\.pi\/settings\.json/);
  assert.deepEqual(projectScoped.supported, undefined);

  const unsupported = defaultPreferencesFailure(422, {
    error: "acme/one does not support thinking level high.",
    reason: "thinking-level-unsupported",
    supported: ["off", "low", "high", "auto"],
  });
  // Only pi's own levels survive the filter, and the message is the route's.
  assert.deepEqual(unsupported.supported, ["off", "low", "high"]);
  assert.match(unsupported.message, /does not support/);

  assert.deepEqual(defaultPreferencesFailure(500, null), { message: "HTTP 500" });
});
