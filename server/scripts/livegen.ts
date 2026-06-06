// Live end-to-end generation smoke test: real provider (OpenRouter/Anthropic
// from .env) -> contract -> packager -> REAL validator. Costs a few cents.
// Run: npm --workspace @wildcard/server run livegen -- "a tip splitter"

import "../src/env.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateTool } from "../src/generate.js";
import { closeValidator } from "../src/validate.js";
import { createModel, activeProviderName } from "../src/provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(here, "../prompts/system.md"), "utf8");

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim() || "a tip splitter";
  console.log(`provider=${activeProviderName()} model=${process.env.WC_MODEL ?? "(default)"}`);
  console.log(`prompt: ${prompt}\n`);

  const model = createModel();
  const result = await generateTool({
    prompt,
    system: SYSTEM_PROMPT,
    model,
    onEvent: (e) => {
      const detail =
        e.type === "validated"
          ? ` pass=${e.pass}${e.errors.length ? " errors=" + JSON.stringify(e.errors) : ""}`
          : e.type === "status"
            ? ` ${e.message}`
            : e.type === "attempt"
              ? ` turn=${e.turn}`
              : "";
      console.log(`· ${e.type}${detail}`);
    },
  });

  await closeValidator();

  console.log("\n--- result ---");
  console.log("ok:", result.ok, "turns:", result.turns);
  if (result.ok) {
    console.log("manifest:", result.bundle!.manifest);
    console.log("\nindex.html (first 400 chars):\n" + result.bundle!.files["index.html"].slice(0, 400));
  } else {
    console.log("reason:", result.reason);
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
