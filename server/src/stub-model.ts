// Dev-only stub provider (enable with WC_PROVIDER=stub). Returns a real,
// self-contained tool that PASSES validation, so the whole app loop
// (prompt -> build -> validate -> run on the grid) works offline with no API
// key and no spend. Never used in production — createModel() only selects this
// when WC_PROVIDER === "stub".

import type { Model } from "./generate.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTool(prompt: string): string {
  const name = prompt.slice(0, 40).replace(/[\n\r]/g, " ").trim() || "Scratchpad";
  const safeName = escapeHtml(name);
  return `<wc-app name="${safeName}" icon="📝" providers="">
\`\`\`file:index.html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font: 16px -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; color: #15151f; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      textarea { width: 100%; min-height: 180px; border: 1px solid #ccc; border-radius: 10px; padding: 12px; font: inherit; box-sizing: border-box; }
      .row { display: flex; gap: 8px; margin-top: 12px; }
      button { flex: 1; padding: 12px; border: 0; border-radius: 10px; background: #7c5cff; color: #fff; font-weight: 600; }
      .saved { color: #4fd08a; font-size: 13px; height: 16px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <h1>${safeName}</h1>
    <textarea id="note" placeholder="Type here — it's saved automatically."></textarea>
    <div class="row">
      <button id="export">Send to output</button>
    </div>
    <div class="saved" id="saved"></div>
    <script>
      const note = document.getElementById("note");
      const saved = document.getElementById("saved");
      (async () => {
        const prev = await WC.storage.get("note");
        if (typeof prev === "string") note.value = prev;
      })();
      let t;
      note.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          await WC.storage.set("note", note.value);
          saved.textContent = "Saved";
          setTimeout(() => (saved.textContent = ""), 1000);
        }, 250);
      });
      document.getElementById("export").addEventListener("click", () => {
        WC.output(note.value, { mime: "text/plain", filename: "note.txt", label: "Your note" });
        WC.ui.toast("Sent to output");
      });
    </script>
  </body>
</html>
\`\`\`
</wc-app>`;
}

export function stubModel(): Model {
  return {
    async complete({ user }) {
      // Simulate a little think time so the live build view is visible.
      await new Promise((r) => setTimeout(r, 400));
      return buildTool(user);
    },
  };
}
