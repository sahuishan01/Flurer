import { describe, test, expect } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { SETTINGS_SECTIONS } from "../src/lib/settingsRegistry";

describe("settings and registry", () => {
  test("closeToTray defaults to false", () => {
    expect(DEFAULT_SETTINGS.closeToTray).toBe(false);
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
});
