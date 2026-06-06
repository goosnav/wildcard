// Offline smoke test for the generation spine: drives generateTool() with a
// STUB model (no API key) through the REAL CMP-05 validator (real Chromium +
// the shared runtime). Proves SSE events → contract parse → packager →
// validation end-to-end. Run: npm --workspace @wildcard/server run dryrun
//
// The stub first returns a deliberately broken tool (references a missing
// global) to exercise the repair path, then returns a working one — so a green
// run demonstrates both the validator catching a real failure AND recovery.

import { generateTool, type Model, type GenEvent } from "../src/generate.js";
import { closeValidator } from "../src/validate.js";

const WORKING_TOOL = `Here you go!
<wc-app name="Tip Splitter" icon="💸" providers="">
\`\`\`file:index.html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Tip Splitter</title></head>
  <body>
    <h1>Tip Splitter</h1>
    <output id="out">—</output>
    <script>
      // Touch the injected WC surface so the validator sees a live tool.
      WC.ui.toast("ready");
      document.getElementById("out").textContent = "ok";
    </script>
  </body>
</html>
\`\`\`
</wc-app>`;

const BROKEN_TOOL = `<wc-app name="Tip Splitter" icon="💸" providers="">
\`\`\`file:index.html
<!doctype html>
<html><body><script>
  // Bug: references an undefined global -> runtime error the validator must catch.
  document.body.textContent = totallyUndefinedGlobal.value;
</script></body></html>
\`\`\`
</wc-app>`;

function stubModel(): Model {
  let call = 0;
  return {
    async complete() {
      call += 1;
      return call === 1 ? BROKEN_TOOL : WORKING_TOOL;
    },
  };
}

async function main() {
  const events: GenEvent[] = [];
  const result = await generateTool({
    prompt: "a tip splitter",
    system: "(stubbed system prompt)",
    model: stubModel(),
    onEvent: (e) => {
      events.push(e);
      const detail =
        e.type === "validated"
          ? ` pass=${e.pass} errors=${JSON.stringify(e.errors)}`
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
  if (result.ok) console.log("bundle:", result.bundle!.manifest);
  else console.log("reason:", result.reason);

  const sawFailThenPass =
    events.some((e) => e.type === "validated" && !e.pass) &&
    events.some((e) => e.type === "validated" && e.pass);
  if (!result.ok || !sawFailThenPass) {
    console.error("\nFAIL: expected the validator to reject the broken tool, then pass the fixed one.");
    process.exit(1);
  }
  console.log("\nPASS: validator caught the broken build and accepted the repaired one.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
