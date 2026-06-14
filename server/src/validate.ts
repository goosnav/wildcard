// CMP-05 — the validation/eval harness. Loads a candidate bundle in headless
// Chromium under the SAME Runtime SDK + sandbox the device uses, and confirms it
// runs before delivery (REQ-GEN-002/010). On web this is true parity: the host
// runtime IS the validation runtime. Output feeds the repair loop or packaging.

import { chromium, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Bundle } from "@wildcard/runtime";
import { providerSamples, isProvider } from "./providers.js";

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_GLOBAL = resolve(here, "../../runtime/dist/runtime.global.js");

export interface ValidationResult {
  pass: boolean;
  errors: string[];
}

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  // `channel: "chromium"` uses the full Chromium build with the new headless
  // mode, avoiding the separate chromium-headless-shell download.
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.isConnected()) return b;
    } catch {
      // a prior launch rejected — fall through and try again
    }
    browserPromise = null; // dead/crashed browser: drop it so we relaunch
  }
  const p = chromium.launch({ channel: "chromium" });
  // Don't cache a rejected launch, or every later call would reuse the failure.
  p.catch(() => {
    if (browserPromise === p) browserPromise = null;
  });
  browserPromise = p;
  return p;
}

export async function closeValidator(): Promise<void> {
  if (browserPromise) {
    const p = browserPromise;
    browserPromise = null;
    try {
      await (await p).close();
    } catch {
      // already gone / failed to launch — nothing to close
    }
  }
}

/**
 * Run static + dynamic checks. The dynamic check mounts the bundle exactly as
 * the host would and watches for fatal console errors and WC error signals
 * during a short settling window.
 */
export async function validate(
  bundle: Bundle,
  opts: { settleMs?: number } = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const html = bundle.files["index.html"] ?? "";

  // --- static checks (cheap, catch the obvious before spinning a browser) ---
  if (!html.trim()) errors.push("index.html is empty");
  if (/<script\s+[^>]*\bsrc\s*=/i.test(html))
    errors.push("Remote <script src> is forbidden (must be self-contained)");
  if (/<link\s+[^>]*\bhref\s*=\s*["']https?:/i.test(html))
    errors.push("Remote <link href> is forbidden (must be self-contained)");
  // A tool may only declare providers that actually exist in the catalog;
  // otherwise it would ship and then fail the moment it calls WC.net.fetch.
  const unknown = bundle.manifest.providers.filter((p) => !isProvider(p));
  if (unknown.length)
    errors.push(
      `Declares unknown data provider(s): ${unknown.join(", ")}. ` +
        `Use only the providers listed in the system prompt, or set providers="".`
    );
  if (errors.length) return { pass: false, errors };

  // --- dynamic check: actually run it ---
  const runtimeSrc = readFileSync(RUNTIME_GLOBAL, "utf8");
  const browser = await getBrowser();
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  try {
    await page.setContent("<!doctype html><html><body><div id='stage'></div></body></html>");
    // esbuild (via tsx) injects calls to a `__name` helper into the inlined
    // page.evaluate closure below when keepNames is on. That helper isn't
    // defined in the page, so define a passthrough before evaluating.
    await page.addScriptTag({
      content: "globalThis.__name = globalThis.__name || ((target) => target);",
    });
    await page.addScriptTag({ content: runtimeSrc });

    const wcErrors: string[] = await page.evaluate(
      async ({ bundle, settleMs, samples }) => {
        const RT = (window as any).WildcardRuntime;
        const errs: string[] = [];
        const mounted = RT.mountTool(document.getElementById("stage"), {
          bundle,
          storage: RT.memoryStorage(),
          // Stub egress with representative samples so live-data tools can be
          // validated offline — we exercise the tool's code, not the upstream.
          net: {
            fetch: (provider: string) =>
              Promise.resolve((samples as Record<string, unknown>)[provider] ?? {}),
          },
          onError: (m: string) => errs.push(m),
        });
        // Let the tool settle, then confirm the frame actually mounted into the
        // DOM with a live content window — not just that mountTool returned an
        // object. (`mounted.frame` is always set, so checking truthiness alone
        // would be a no-op.)
        const frame = mounted.frame as HTMLIFrameElement;
        await new Promise((r) => setTimeout(r, settleMs));
        if (!frame.isConnected || !frame.contentWindow) {
          errs.push("Tool frame failed to mount");
        }
        return errs;
      },
      { bundle: bundle as any, settleMs: opts.settleMs ?? 400, samples: providerSamples() }
    );

    errors.push(...wcErrors, ...consoleErrors);
    return { pass: errors.length === 0, errors };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { pass: false, errors };
  } finally {
    await page.close();
  }
}
