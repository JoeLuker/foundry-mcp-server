import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, mockDeleteResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerEffectTools } from "./effects.js";

describe("effect tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerEffectTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_list_active_effects", () => {
    it("lists effects with default fields", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "eff-1", name: "Bless", icon: "icons/magic/life/cross-area-circle-green-white.webp", disabled: false, duration: {}, changes: [], statuses: [] },
          { _id: "eff-2", name: "Poisoned", icon: "icons/svg/poison.svg", disabled: false, duration: {}, changes: [], statuses: ["poisoned"] },
        ]),
      );

      const result = await invokeTool(server, "foundry_list_active_effects", {
        actorId: "actor-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.total).toBe(2);
      expect(data.actorId).toBe("actor-1");
      const effects = data.effects as Record<string, unknown>[];
      expect(effects[0].name).toBe("Bless");
      expect(effects[1].statuses).toEqual(["poisoned"]);
    });

    it("selects custom fields", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "eff-1", name: "Bless", disabled: false }]),
      );

      const result = await invokeTool(server, "foundry_list_active_effects", {
        actorId: "actor-1",
        fields: ["_id", "name"],
      });
      const data = parseResponse(result) as Record<string, unknown>;
      const effects = data.effects as Record<string, unknown>[];
      expect(effects[0]).toEqual({ _id: "eff-1", name: "Bless" });
    });
  });

  describe("foundry_apply_active_effect", () => {
    it("creates an effect with changes", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "eff-new" }]),
      );

      const result = await invokeTool(server, "foundry_apply_active_effect", {
        actorId: "actor-1",
        name: "Shield of Faith",
        changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
        disabled: false,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.applied).toBe(true);
      expect(data.effectId).toBe("eff-new");
      expect(data.name).toBe("Shield of Faith");

      const callArgs = vi.mocked(client.modifyDocument).mock.calls[0];
      expect(callArgs[0]).toBe("ActiveEffect");
      expect(callArgs[1]).toBe("create");
      const payload = callArgs[2] as { data: Record<string, unknown>[]; parentUuid: string };
      expect(payload.parentUuid).toBe("Actor.actor-1");
      expect(payload.data[0].changes).toEqual([{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }]);
    });

    it("creates a minimal effect", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "eff-min" }]),
      );

      const result = await invokeTool(server, "foundry_apply_active_effect", {
        actorId: "actor-1",
        name: "Marker",
        disabled: false,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.applied).toBe(true);
    });
  });

  describe("foundry_remove_active_effect", () => {
    it("deletes an effect", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockDeleteResponse(["eff-1"]));

      const result = await invokeTool(server, "foundry_remove_active_effect", {
        actorId: "actor-1",
        effectId: "eff-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.removed).toBe(true);

      expect(client.modifyDocument).toHaveBeenCalledWith("ActiveEffect", "delete", {
        ids: ["eff-1"],
        parentUuid: "Actor.actor-1",
      });
    });
  });

  describe("foundry_toggle_active_effect", () => {
    it("disables an effect", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_toggle_active_effect", {
        actorId: "actor-1",
        effectId: "eff-1",
        disabled: true,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.disabled).toBe(true);

      expect(client.modifyDocument).toHaveBeenCalledWith("ActiveEffect", "update", {
        updates: [{ _id: "eff-1", disabled: true }],
        parentUuid: "Actor.actor-1",
      });
    });

    it("enables an effect", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_toggle_active_effect", {
        actorId: "actor-1",
        effectId: "eff-1",
        disabled: false,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.disabled).toBe(false);
    });
  });
});
