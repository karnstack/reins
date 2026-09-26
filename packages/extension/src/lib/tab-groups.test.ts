import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupsUnsupported, groupsSupported, listGroups } from "./tab-groups.js";

afterEach(() => vi.unstubAllGlobals());

/** Minimal chrome with a working tab-group API. */
function stubGroups(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("chrome", {
    tabs: {
      query: async () => [
        { id: 1, groupId: 7 },
        { id: 2, groupId: 7 },
        { id: 3, groupId: -1 },
      ],
      group: vi.fn(async () => 7),
      ungroup: vi.fn(async () => undefined),
      get: async (id: number) => ({ id, windowId: 1 }),
    },
    tabGroups: {
      query: async () => [{ id: 7, title: "reins", color: "blue", collapsed: false, windowId: 1 }],
      update: vi.fn(async () => ({})),
    },
    ...overrides,
  });
}

describe("groupsSupported", () => {
  it("is true when tabGroups and tabs.group/ungroup exist", () => {
    stubGroups();
    expect(groupsSupported()).toBe(true);
  });

  it("is false without chrome.tabGroups", () => {
    stubGroups({ tabGroups: undefined });
    expect(groupsSupported()).toBe(false);
  });

  it("is false when tabs.group is missing", () => {
    stubGroups({ tabs: { query: async () => [] } });
    expect(groupsSupported()).toBe(false);
  });
});

describe("listGroups", () => {
  it("maps groups and counts their tabs", async () => {
    stubGroups();
    expect(await listGroups()).toEqual({
      groups: [
        { groupId: 7, title: "reins", color: "blue", collapsed: false, windowId: 1, tabCount: 2 },
      ],
    });
  });

  it("untitled groups get an empty title", async () => {
    stubGroups({
      tabGroups: {
        query: async () => [{ id: 9, color: "red", collapsed: true, windowId: 2 }],
        update: async () => ({}),
      },
    });
    const { groups } = await listGroups();
    expect(groups[0]).toMatchObject({ groupId: 9, title: "", tabCount: 0 });
  });

  it("throws code=unsupported when the browser has no tab groups", async () => {
    stubGroups({ tabGroups: undefined });
    const err = await listGroups().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroupsUnsupported);
    expect((err as GroupsUnsupported).code).toBe("unsupported");
    expect((err as Error).message).toBe(
      "this browser doesn't support tab groups (chrome.tabGroups unavailable)",
    );
  });
});
