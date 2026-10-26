import { describe, test, expect } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { SETTINGS_SECTIONS } from "../src/lib/settingsRegistry";
import { getOrderedPlugins } from "../src/lib/plugins";

describe("settings and registry", () => {
  test("closeToTray defaults to false", () => {
    expect(DEFAULT_SETTINGS.closeToTray).toBe(false);
  });

  test("pluginOrder defaults to empty array", () => {
    expect(DEFAULT_SETTINGS.pluginOrder).toEqual([]);
  });

  test("getOrderedPlugins orders items according to custom order", () => {
    const items = [
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
      { id: "gamma", name: "Gamma" },
    ];

    expect(getOrderedPlugins(items, ["gamma", "alpha"])).toEqual([
      { id: "gamma", name: "Gamma" },
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
    ]);

    expect(getOrderedPlugins(items, [])).toEqual(items);
    expect(getOrderedPlugins(items, undefined)).toEqual(items);
  });

  test("settingsRegistry contains closeToTray under customization.startup", () => {
    const startupSection = SETTINGS_SECTIONS.find((s) => s.id === "customization.startup");
    expect(startupSection).toBeDefined();

    const closeToTrayItem = startupSection?.items.find((item) => item.id === "customization.startup.closeToTray");
    expect(closeToTrayItem).toBeDefined();
    expect(closeToTrayItem?.label).toBe("Close to tray");
    expect(closeToTrayItem?.keywords).toContain("close to tray");
    expect(closeToTrayItem?.keywords).toContain("tray");
    expect(closeToTrayItem?.keywords).toContain("notification");
  });

  test("settingsRegistry contains reorder keywords under plugins.installed", () => {
    const installedSection = SETTINGS_SECTIONS.find((s) => s.id === "plugins.installed");
    expect(installedSection).toBeDefined();

    const installedItem = installedSection?.items.find((item) => item.id === "plugins.installed.list");
    expect(installedItem).toBeDefined();
    expect(installedItem?.keywords).toContain("order");
    expect(installedItem?.keywords).toContain("reorder");
    expect(installedItem?.keywords).toContain("position");
  });
});
