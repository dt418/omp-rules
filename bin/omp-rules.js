import ompRulesPlugin from "./index.js";
import { syncAndValidateRules, generateDefaultRules, getAvailableModelKeys } from "./index.js";

const args = process.argv.slice(2);
const sub = (args[0] || "sync").toLowerCase();

if (sub === "help" || sub === "--help" || sub === "-h") {
  console.log(`Usage: omp-rules [command]

Commands:
  sync       Prune unavailable models from fallback rules in ~/.omp/agent/config.yml (default)
  validate   Check validity of roles and fallback rules without writing changes (dry-run)
  generate   Print recommended fallback rules YAML from currently catalogued models
  list       Print all catalogued available models
  help       Show this help
`);
  process.exit(0);
}

if (sub === "list") {
  const models = getAvailableModelKeys();
  console.log(`Catalogued models (${models.size}):\n` + Array.from(models).join("\n"));
  process.exit(0);
}

if (sub === "generate") {
  const yaml = generateDefaultRules();
  console.log(yaml);
  process.exit(0);
}

const dryRun = sub === "validate";
const res = syncAndValidateRules(undefined, dryRun);

console.log(`[omp-rules] Available models in catalog: ${res.totalAvailable}`);

if (res.prunedChains.length > 0) {
  console.log(dryRun ? "\nModels that would be pruned:" : "\nPruned unavailable models:");
  for (const c of res.prunedChains) {
    console.log(`  - ${c.chain}: removed [${c.removed.join(", ")}]`);
  }
} else {
  console.log("Fallback chains: All configured models are currently valid.");
}

if (res.invalidRoles.length > 0) {
  console.log("\nWarning: Roles using missing models:");
  for (const r of res.invalidRoles) {
    console.log(`  - ${r.role} -> ${r.model}`);
  }
}
