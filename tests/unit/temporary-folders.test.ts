import { describe, expect, it } from "vitest";
import { isTemporaryPath } from "@/lib/temporaryPath";
import { sidebarPreferencesStore } from "@/stores/sidebarPreferences";

describe("temporary folders", () => {
  it.each([
    "C:\\Users\\test-user\\AppData\\Local\\Temp\\mandri-capture\\tools-diff",
    "c:/users/test/appdata/local/TEMP/project",
    "C:\\Windows\\Temp\\project",
    "D:\\Temp\\project",
    "/tmp/project",
    "/tmp",
    "/var/tmp/project",
    "/private/tmp/project",
    "/private/var/folders/ab/random/T/project",
    "/var/folders/ab/random/T/project",
    "%TEMP%/project",
    "%TMP%/project",
  ])("recognizes %s", (path) => expect(isTemporaryPath(path)).toBe(true));

  it.each([
    "/tmp-project",
    "/home/user/tmp/project",
    "D:\\Dev\\Temp\\project",
    "C:/Users/test/AppData/Local/Template/project",
    "/var/folders/ab/random/other",
    "",
    "ungrouped",
  ])("preserves %s", (path) => expect(isTemporaryPath(path)).toBe(false));

  it("defaults off and persists the local toggle", async () => {
    localStorage.removeItem("mandri.sidebar");
    await sidebarPreferencesStore.persist.rehydrate();
    expect(sidebarPreferencesStore.getState().hideTemporaryFolders).toBe(false);
    sidebarPreferencesStore.getState().setHideTemporaryFolders(true);
    const saved = localStorage.getItem("mandri.sidebar")!;
    expect(JSON.parse(saved).state.hideTemporaryFolders).toBe(true);
    sidebarPreferencesStore.getState().setHideTemporaryFolders(false);
    localStorage.setItem("mandri.sidebar", saved);
    await sidebarPreferencesStore.persist.rehydrate();
    expect(sidebarPreferencesStore.getState().hideTemporaryFolders).toBe(true);
    sidebarPreferencesStore.getState().setHideTemporaryFolders(false);
  });
});
