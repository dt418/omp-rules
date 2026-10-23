/**
 * omp-rules — OMP plugin & tool provider for model catalogue sync, validation, and fallback chain rules maintenance.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CONFIG_PATH = join(homedir(), ".omp", "agent", "config.yml");
const MODELS_DB_PATH = join(homedir(), ".omp", "agent", "models.db");

function parseSelector(full) {
  const [target, effort] = full.split(":");
  const slashIdx = target.indexOf("/");
  if (slashIdx === -1) {
    return { provider: "", modelId: target, effort };
  }
  return {
    provider: target.slice(0, slashIdx),
    modelId: target.slice(slashIdx + 1),
    effort,
  };
}

export function getAvailableModelKeys(ctx) {
  const set = new Set();

  if (ctx?.modelRegistry && typeof ctx.modelRegistry.getAvailable === "function") {
    try {
      const list = ctx.modelRegistry.getAvailable();
      if (Array.isArray(list)) {
        for (const m of list) {
          if (m?.provider && m?.id) {
            set.add(`${m.provider}/${m.id}`);
          }
        }
      }
    } catch {}
  }

  if (existsSync(MODELS_DB_PATH)) {
    try {
      const db = new DatabaseSync(MODELS_DB_PATH, { readOnly: true });
      const query = db.prepare("SELECT models FROM model_cache");
      const rows = query.all();
      for (const row of rows) {
        if (!row || typeof row !== "object" || !("models" in row)) continue;
        const modelsJson = row.models;
        if (typeof modelsJson !== "string") continue;
        try {
          const parsed = JSON.parse(modelsJson);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (
                item &&
                typeof item === "object" &&
                "provider" in item &&
                "id" in item &&
                typeof item.provider === "string" &&
                typeof item.id === "string"
              ) {
                set.add(`${item.provider}/${item.id}`);
              }
            }
          }
        } catch {}
      }
      db.close();
    } catch {}
  }

  return set;
}

export function syncAndValidateRules(ctx, dryRun = false) {
  const available = getAvailableModelKeys(ctx);
  const result = {
    prunedChains: [],
    invalidRoles: [],
    totalAvailable: available.size,
  };

  if (!existsSync(CONFIG_PATH) || available.size === 0) {
    return result;
  }

  const content = readFileSync(CONFIG_PATH, "utf8");
  const lines = content.split(/\r?\n/);

  let inFallbackChains = false;
  let currentChain = "";
  const linesToDrop = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*fallbackChains:\s*$/.test(line)) {
      inFallbackChains = true;
      continue;
    }

    if (inFallbackChains) {
      if (/^[a-zA-Z0-9_-]+:/.test(line)) {
        inFallbackChains = false;
        currentChain = "";
        continue;
      }

      const chainMatch = line.match(/^\s{4}([a-zA-Z0-9_-]+):\s*$/);
      if (chainMatch) {
        currentChain = chainMatch[1];
        continue;
      }

      const itemMatch = line.match(/^\s{6}-\s+([^\s#]+)/);
      if (itemMatch && currentChain) {
        const fullModel = itemMatch[1];
        const { provider, modelId } = parseSelector(fullModel);
        const key = `${provider}/${modelId}`;

        if (provider && !available.has(key)) {
          linesToDrop.add(i);
          let foundChain = result.prunedChains.find((c) => c.chain === currentChain);
          if (!foundChain) {
            foundChain = { chain: currentChain, removed: [] };
            result.prunedChains.push(foundChain);
          }
          foundChain.removed.push(fullModel);
        }
      }
    }

    const roleMatch = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s+([^\s#]+)/);
    if (!inFallbackChains && roleMatch) {
      const role = roleMatch[1];
      const model = roleMatch[2];
      const { provider, modelId } = parseSelector(model);
      if (provider && !available.has(`${provider}/${modelId}`)) {
        result.invalidRoles.push({ role, model });
      }
    }
  }

  if (!dryRun && linesToDrop.size > 0) {
    const newLines = lines.filter((_, idx) => !linesToDrop.has(idx));
    writeFileSync(CONFIG_PATH, newLines.join("\n"), "utf8");
  }

  return result;
}

export function generateDefaultRules(ctx) {
  const available = getAvailableModelKeys(ctx);
  const models = Array.from(available);

  const sol = models.filter((m) => m.includes("sol"));
  const astra = models.filter((m) => m.includes("astra"));
  const terra = models.filter((m) => m.includes("terra"));
  const luna = models.filter((m) => m.includes("luna"));
  const deepseek = models.filter((m) => m.includes("deepseek"));
  const mimo = models.filter((m) => m.includes("mimo"));

  const defaultChain = [...terra, ...deepseek, ...mimo, ...sol];
  const smolChain = [...terra.map((m) => `${m}:medium`), ...sol, ...deepseek];
  const slowChain = [...astra.map((m) => `${m}:xhigh`), ...terra];
  const taskChain = [...luna.map((m) => `${m}:high`), ...sol.map((m) => `${m}:high`), ...deepseek, ...mimo];
  const advisorChain = [...astra.map((m) => `${m}:high`), ...sol.map((m) => `${m}:high`), ...deepseek];

  const lines = [
    "retry:",
    "  fallbackChains:",
    "    default:",
    ...defaultChain.map((m) => `      - ${m}`),
    "    smol:",
    ...smolChain.map((m) => `      - ${m}`),
    "    slow:",
    ...slowChain.map((m) => `      - ${m}`),
    "    task:",
    ...taskChain.map((m) => `      - ${m}`),
    "    advisor:",
    ...advisorChain.map((m) => `      - ${m}`),
  ];

  return lines.join("\n");
}

export default function ompRulesPlugin(pi) {
  const commandHandler = async (args, ctx) => {
    const sub = (args || "").trim().toLowerCase();

    if (sub === "help") {
      ctx.ui?.notify?.(
        "omp-rules commands:\n" +
          "  /omp-rules sync      - Prune unavailable models from fallback rules\n" +
          "  /omp-rules validate  - Inspect validity of roles and fallback rules\n" +
          "  /omp-rules generate  - Output recommended fallback rules from available catalog\n" +
          "  /omp-rules list      - List catalogued available models\n",
        "info"
      );
      return;
    }

    if (sub === "list") {
      const avail = getAvailableModelKeys(ctx);
      if (avail.size === 0) {
        ctx.ui?.notify?.("No catalogued models found in current registry.", "warning");
      } else {
        ctx.ui?.notify?.(`Catalogued models (${avail.size}):\n` + Array.from(avail).join("\n"), "info");
      }
      return;
    }

    if (sub === "generate") {
      const generated = generateDefaultRules(ctx);
      ctx.ui?.notify?.(`Generated fallback rules:\n\n${generated}`, "info");
      return;
    }

    const isDryRun = sub === "validate";
    const res = syncAndValidateRules(ctx, isDryRun);

    let msg = `[omp-rules] Catalogued models: ${res.totalAvailable}\n`;

    if (res.prunedChains.length > 0) {
      const details = res.prunedChains
        .map((c) => `  - ${c.chain}: removed [${c.removed.join(", ")}]`)
        .join("\n");
      msg += (isDryRun ? "Models to prune:\n" : "Pruned unavailable models:\n") + details + "\n";
    } else {
      msg += "Fallback chains: All configured models are currently valid.\n";
    }

    if (res.invalidRoles.length > 0) {
      const roles = res.invalidRoles.map((r) => `  - ${r.role} -> ${r.model}`).join("\n");
      msg += `Warning: Roles using missing models:\n${roles}\n`;
    }

    ctx.ui?.notify?.(msg, res.invalidRoles.length > 0 ? "warning" : "info");
  };

  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("omp-rules", {
      description: "Model catalog sync, validation, and fallback rules generation",
      handler: commandHandler,
    });
    pi.registerCommand("omp:rules", {
      description: "Alias for /omp-rules",
      handler: commandHandler,
    });
  }

  if (typeof pi.registerTool === "function") {
    pi.registerTool({
      name: "omp_rules",
      label: "Sync, validate, and generate OMP model rules",
      description:
        "Manage, validate, sync, and generate fallback rules in OMP based on currently catalogued available models.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["sync", "validate", "generate", "list"],
            description:
              "The operation to perform: 'sync' (prune dead models from config), 'validate' (dry-run check), 'generate' (produce updated rules YAML), or 'list' (list available models).",
          },
          dryRun: {
            type: "boolean",
            description: "If true, do not modify config.yml even on sync.",
          },
        },
        required: ["action"],
      },
      async execute(_toolCallId, params) {
        const action = params.action || "validate";
        const isDryRun = params.dryRun ?? (action === "validate");

        if (action === "list") {
          const avail = getAvailableModelKeys();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    totalAvailable: avail.size,
                    models: Array.from(avail),
                  },
                  null,
                  2
                ),
              },
            ],
            details: { count: avail.size },
          };
        }

        if (action === "generate") {
          const generated = generateDefaultRules();
          return {
            content: [{ type: "text", text: generated }],
            details: { action: "generate" },
          };
        }

        const res = syncAndValidateRules(undefined, isDryRun);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  action,
                  dryRun: isDryRun,
                  ...res,
                },
                null,
                2
              ),
            },
          ],
          details: { ...res },
        };
      },
    });
  }

  if (typeof pi.on === "function") {
    pi.on("session_start", (_event, rawCtx) => {
      try {
        const ctx = rawCtx && typeof rawCtx === "object" ? rawCtx : {};
        const res = syncAndValidateRules(ctx, false);
        if (res.prunedChains.length > 0) {
          const count = res.prunedChains.reduce((acc, c) => acc + c.removed.length, 0);
          ctx.ui?.notify?.(
            `[omp-rules] Auto-pruned ${count} obsolete model(s) from fallback chains.`,
            "info"
          );
        }
      } catch {}
    });
  }
}
