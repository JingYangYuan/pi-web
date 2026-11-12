import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { filteredPackagesKeptOn, packagesToSwitch } = await jiti.import("./PluginsConfig.tsx");

const packages = [
  { source: "npm:global-on", scope: "global", disabled: false, filtered: false },
  { source: "npm:global-off", scope: "global", disabled: true, filtered: true },
  { source: "npm:project-on", scope: "project", disabled: false, filtered: false },
];

test("a group switch targets the packages that would change", () => {
  assert.deepEqual(packagesToSwitch(packages, true).map((pkg) => pkg.source), ["npm:global-off"]);
  assert.deepEqual(packagesToSwitch(packages, false).map((pkg) => pkg.source), ["npm:global-on", "npm:project-on"]);
  assert.deepEqual(packagesToSwitch(packages.filter((pkg) => !pkg.disabled), true), []);
});

test("switching a group off leaves an enabled filtered package on and says so", () => {
  // Disabling empties its resource lists, and nothing would bring the filters back.
  const withFiltered = [...packages, { source: "npm:filtered-on", scope: "global", disabled: false, filtered: true }];
  assert.deepEqual(packagesToSwitch(withFiltered, false).map((pkg) => pkg.source), ["npm:global-on", "npm:project-on"]);
  assert.deepEqual(filteredPackagesKeptOn(withFiltered).map((pkg) => pkg.source), ["npm:filtered-on"]);
});

const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { PackageDetail } = await jiti.import("./PluginsConfig.tsx");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");

const h = React.createElement;
const UPDATE_AVAILABLE = { source: "npm:some-plugin", scope: "global", displayName: "some-plugin", state: "update-available" };

function packageInfo(overrides = {}) {
  return {
    source: "npm:some-plugin",
    scope: "global",
    managedByHub: false,
    canCheckForUpdates: true,
    filtered: false,
    disabled: false,
    counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
    resources: [],
    status: "loaded",
    ...overrides,
  };
}

function renderDetail(pkg) {
  return renderToStaticMarkup(
    h(I18nProvider, null, h(PackageDetail, {
      pkg,
      cwd: "/work/app",
      busyKey: null,
      actionError: null,
      actionMessage: null,
      sessionId: "session-1",
      updateStatus: UPDATE_AVAILABLE,
      checkingUpdate: false,
      updateError: null,
      onAction: () => {},
      onCheckUpdate: () => {},
      onReloadSession: () => {},
    })),
  );
}

test("a hub-managed package shows the badge and no remove or update button", () => {
  const html = renderDetail(packageInfo({ managedByHub: true }));

  assert.match(html, new RegExp(enLocale.messages["plugins.hubManaged"]));
  // Why the buttons are gone is visible text, not a tooltip: a touch screen
  // cannot show a title.
  assert.match(html, new RegExp(enLocale.messages["plugins.hubManagedNote"].slice(0, 40)));
  assert.doesNotMatch(html, />Remove</);
  assert.doesNotMatch(html, />Update</);
  // The account still decides whether it loads.
  assert.match(html, new RegExp(`aria-label="${enLocale.messages["i18n.disablePackage"]}"`));
});

test("a package the account installed itself keeps both actions", () => {
  const html = renderDetail(packageInfo());

  assert.doesNotMatch(html, new RegExp(enLocale.messages["plugins.hubManaged"]));
  assert.match(html, />Update</);
  assert.match(html, />Remove</);
});
