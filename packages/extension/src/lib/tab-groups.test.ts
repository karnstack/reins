import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GroupsUnsupported,
  groupsSupported,
  groupTabIds,
  groupTabs,
  listGroups,
  ungroupTabs,
  updateGroup,
} from "./tab-groups.js";

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

  it("is false without chrome.tabGroups (Arc, Dia, …)", () => {
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

describe("groupTabs", () => {
  it("creates a new group in the first tab's window, then applies props", async () => {
    stubGroups();
    const out = await groupTabs({ tabIds: [1, 2], title: "reins", color: "blue" });
    expect(out).toEqual({ groupId: 7 });
    expect(chrome.tabs.group).toHaveBeenCalledWith({
      tabIds: [1, 2],
      createProperties: { windowId: 1 },
    });
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(7, { title: "reins", color: "blue" });
  });

  it("adds to an existing group without createProperties, and skips update when no props", async () => {
    stubGroups();
    await groupTabs({ tabIds: [3], groupId: 7 });
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [3], groupId: 7 });
    expect(chrome.tabGroups.update).not.toHaveBeenCalled();
  });

  it("refuses with code=unsupported on browsers without groups", async () => {
    stubGroups({ tabGroups: undefined });
    await expect(groupTabs({ tabIds: [1] })).rejects.toBeInstanceOf(GroupsUnsupported);
  });
});

describe("updateGroup", () => {
  it("passes only the given props", async () => {
    stubGroups();
    expect(await updateGroup({ groupId: 7, collapsed: true })).toEqual({ ok: true });
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(7, { collapsed: true });
  });
});

describe("ungroupTabs / groupTabIds", () => {
  it("ungroups exactly the gate-resolved ids, never re-resolving (tabs stay open)", async () => {
    stubGroups();
    const query = vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]);
    (chrome.tabs as { query: unknown }).query = query;
    expect(await ungroupTabs({ tabIds: [1, 2] })).toEqual({ ok: true });
    expect(chrome.tabs.ungroup).toHaveBeenCalledWith([1, 2]);
    expect(query).not.toHaveBeenCalled();
  });

  it("an empty set is a no-op", async () => {
    stubGroups();
    await ungroupTabs({ tabIds: [] });
    expect(chrome.tabs.ungroup).not.toHaveBeenCalled();
  });

  it("groupTabIds drops tabs without an id", async () => {
    stubGroups();
    (chrome.tabs as { query: unknown }).query = async () => [{ id: 4 }, {}];
    expect(await groupTabIds(7)).toEqual([4]);
  });
});
