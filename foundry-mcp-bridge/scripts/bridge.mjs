/**
 * Foundry MCP Bridge — Browser-side RPC handler.
 *
 * Listens for RPC requests from the foundry-mcp-server via the
 * "module.foundry-mcp-bridge" socket channel and executes them
 * in the full game context.
 *
 * Only active for GM users.
 */

const MODULE_ID = "foundry-mcp-bridge";

// ── Method Registry ────────────────────────────────────────────────

const methods = new Map();

methods.set("eval", async (params) => {
  const { script } = params;
  if (typeof script !== "string") {
    throw new Error("eval requires a 'script' string parameter");
  }
  // AsyncFunction allows top-level await in the script
  const fn = new AsyncFunction("game", "canvas", "ui", "foundry", script);
  return await fn(game, canvas, ui, foundry);
});

methods.set("ping", async () => {
  return {
    alive: true,
    user: game.user.name,
    userId: game.user.id,
    worldId: game.world.id,
    systemId: game.system.id,
  };
});

methods.set("getCanvasDimensions", async () => {
  if (!canvas?.ready) {
    return { ready: false };
  }
  return {
    ready: true,
    width: canvas.dimensions?.width,
    height: canvas.dimensions?.height,
    sceneRect: canvas.dimensions?.sceneRect,
    gridSize: canvas.grid?.size,
    gridType: canvas.grid?.type,
    sceneId: canvas.scene?.id,
    sceneName: canvas.scene?.name,
  };
});

methods.set("getTokensOnCanvas", async () => {
  if (!canvas?.ready || !canvas.tokens?.placeables) {
    return [];
  }
  return canvas.tokens.placeables.map((t) => ({
    id: t.id,
    name: t.name,
    actorId: t.actor?.id ?? null,
    actorName: t.actor?.name ?? null,
    x: t.x,
    y: t.y,
    elevation: t.document?.elevation ?? 0,
    visible: t.visible,
    hidden: t.document?.hidden ?? false,
    combatant: t.combatant?.id ?? null,
    hp: (() => {
      try {
        const hp = t.actor?.system?.attributes?.hp;
        if (hp) return { value: hp.value, max: hp.max, temp: hp.temp ?? 0 };
      } catch { /* system may not have hp */ }
      return null;
    })(),
  }));
});

methods.set("rollFormula", async (params) => {
  const { formula, flavor } = params;
  if (typeof formula !== "string") {
    throw new Error("rollFormula requires a 'formula' string parameter");
  }
  const roll = await new Roll(formula).evaluate();
  return {
    formula: roll.formula,
    total: roll.total,
    dice: roll.dice.map((d) => ({
      faces: d.faces,
      results: d.results.map((r) => r.result),
    })),
    flavor: flavor ?? null,
  };
});

methods.set("fromUuid", async (params) => {
  const { uuid } = params;
  if (typeof uuid !== "string") {
    throw new Error("fromUuid requires a 'uuid' string parameter");
  }
  const doc = await fromUuid(uuid);
  if (!doc) return null;
  return doc.toObject();
});

methods.set("getModuleApis", async () => {
  const result = [];
  for (const [id, mod] of game.modules) {
    if (!mod.active) continue;
    result.push({
      id,
      title: mod.title,
      version: mod.version,
      hasApi: !!mod.api,
      apiMethods: mod.api ? Object.keys(mod.api) : [],
    });
  }
  return result;
});

methods.set("callModuleApi", async (params) => {
  const { moduleId, method, args } = params;
  if (typeof moduleId !== "string") {
    throw new Error("callModuleApi requires a 'moduleId' string parameter");
  }
  if (typeof method !== "string") {
    throw new Error("callModuleApi requires a 'method' string parameter");
  }
  const mod = game.modules.get(moduleId);
  if (!mod?.active) {
    throw new Error(`Module "${moduleId}" is not active`);
  }
  if (!mod.api || typeof mod.api !== "object") {
    throw new Error(`Module "${moduleId}" does not expose a public API`);
  }
  const fn = mod.api[method];
  if (typeof fn !== "function") {
    throw new Error(
      `Module "${moduleId}" API has no method "${method}". ` +
        `Available: ${Object.keys(mod.api).join(", ")}`,
    );
  }
  return await fn(...(Array.isArray(args) ? args : []));
});

// ── Socket Handler ─────────────────────────────────────────────────

Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  console.log(`${MODULE_ID} | RPC bridge active for GM: ${game.user.name}`);

  game.socket.on(`module.${MODULE_ID}`, async (message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "rpc-request") {
      await handleRequest(message);
    } else if (message.type === "rpc-ping") {
      game.socket.emit(`module.${MODULE_ID}`, {
        type: "rpc-pong",
        requestId: message.requestId,
        moduleVersion:
          game.modules.get(MODULE_ID)?.version ?? "unknown",
        userId: game.user.id,
      });
    }
  });
});

async function handleRequest(request) {
  const { requestId, method, args } = request;
  const startTime = performance.now();

  try {
    const handler = methods.get(method);
    if (!handler) {
      throw new Error(
        `Unknown RPC method: "${method}". Available: ${[...methods.keys()].join(", ")}`,
      );
    }

    const params = args?.[0] ?? {};
    const result = await handler(params);

    // Serialization fence — prevent circular refs from crashing the socket
    const serialized = JSON.parse(JSON.stringify(result ?? null));

    game.socket.emit(`module.${MODULE_ID}`, {
      type: "rpc-response",
      requestId,
      success: true,
      result: serialized,
      duration: Math.round(performance.now() - startTime),
    });
  } catch (err) {
    game.socket.emit(`module.${MODULE_ID}`, {
      type: "rpc-response",
      requestId,
      success: false,
      error: err.message ?? String(err),
      duration: Math.round(performance.now() - startTime),
    });
  }
}
