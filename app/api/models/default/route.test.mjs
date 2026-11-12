import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-default-route-"));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
process.env.PI_CODING_AGENT_DIR = agentDir;
// The model list comes from the models.json below, not from a provider catalog.
process.env.PI_OFFLINE = "1";

await mkdir(agentDir, { recursive: true });
await mkdir(cwd);
// `high` and `xhigh` are marked unsupported, as an advertised effort list does.
await writeFile(join(agentDir, "models.json"), JSON.stringify({
  providers: {
    acme: {
      baseUrl: "https://example.invalid/v1",
      apiKey: "sk-test",
      api: "openai-completions",
      models: [{
        id: "one",
        name: "Acme One",
        reasoning: true,
        thinkingLevelMap: { high: null, xhigh: null },
      }],
    },
  },
}, null, 2));

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { GET, PUT } = await jiti.import("./route.ts");
allowFileRoot(cwd);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
  await rm(root, { recursive: true, force: true });
});

async function put(body) {
  const response = await PUT(new Request("http://localhost/api/models/default", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

async function settings() {
  return JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
}

test("a level the chosen model disables is refused with the levels it accepts", async () => {
  const { status, body } = await put({
    cwd,
    provider: "acme",
    modelId: "one",
    thinkingLevel: "high",
  });

  assert.equal(status, 422);
  assert.equal(body.reason, "thinking-level-unsupported");
  assert.deepEqual(body.supported, ["off", "minimal", "low", "medium", "max"]);
  assert.match(body.error, /acme\/one/);
  // Nothing reached settings.json, so a new session does not start on a level
  // this model would clamp away.
  await assert.rejects(readFile(join(agentDir, "settings.json"), "utf8"));
});

test("a model and a level it accepts are saved together", async () => {
  const { status, body } = await put({
    cwd,
    provider: "acme",
    modelId: "one",
    thinkingLevel: "low",
  });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(await settings(), {
    defaultProvider: "acme",
    defaultModel: "one",
    defaultThinkingLevel: "low",
  });
});

test("a model without a level map keeps every level, xhigh and max included", async () => {
  const models = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8"));
  models.providers.acme.models.push({ id: "two", name: "Acme Two", reasoning: true });
  await writeFile(join(agentDir, "models.json"), JSON.stringify(models, null, 2));

  for (const level of ["xhigh", "max"]) {
    const { status } = await put({ cwd, provider: "acme", modelId: "two", thinkingLevel: level });
    assert.equal(status, 200, `${level} must be accepted`);
  }
});

test("an unknown model is still refused", async () => {
  const { status } = await put({ cwd, provider: "acme", modelId: "missing", thinkingLevel: "low" });
  assert.equal(status, 404);
});

test("a level without a model is left to the session's own model", async () => {
  // The reasoning selector's star sends only the level; the route cannot know
  // which model is chat's, so it must not guess one to validate against.
  const { status } = await put({ cwd, thinkingLevel: "high" });
  assert.equal(status, 200);
  assert.equal((await settings()).defaultThinkingLevel, "high");
});

test("the read reports the saved values and the host default the hub wrote", async () => {
  // The credential broker records what it wrote there on every sync, so the
  // panel can tell "following the host" from "overridden".
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "acme",
    defaultModel: "one",
    defaultThinkingLevel: "medium",
    pihubPackages: ["npm:hub"],
    pihubDefaults: { defaultProvider: "acme", defaultModel: "one", defaultThinkingLevel: "low" },
  }, null, 2));

  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.defaultProvider, "acme");
  assert.equal(body.defaultModel, "one");
  assert.equal(body.defaultThinkingLevel, "medium");
  assert.deepEqual(body.hubDefaults, {
    defaultProvider: "acme",
    defaultModel: "one",
    defaultThinkingLevel: "low",
  });
  assert.match(body.settingsPath, /settings\.json$/);
});

test("the read reports no host default on a plain Pi Web install", async () => {
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultThinkingLevel: "low" }));
  const body = await (await GET()).json();
  assert.equal(body.defaultProvider, null);
  assert.equal(body.defaultModel, null);
  assert.equal(body.defaultThinkingLevel, "low");
  assert.equal(body.hubDefaults, null);
});

test("a settings file the panel could not save over answers with its parse error", async () => {
  await writeFile(join(agentDir, "settings.json"), "{ oops");
  const response = await GET();
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /settings\.json/);
});
