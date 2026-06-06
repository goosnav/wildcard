// The generation output contract. The model must return a tool as a strict,
// machine-parseable set of files so packaging is DETERMINISTIC (no guessing).
// This is the single highest-leverage reliability lever for Tier-1.
//
// Expected model output format:
//
//   <wc-app name="Tip Splitter" icon="💸" providers="">
//   ```file:index.html
//   <!doctype html> ...
//   ```
//   ```file:app.js
//   ...
//   ```
//   </wc-app>
//
// Only index.html is required. Extra files are bundled as-is. `providers` is a
// comma-separated list of declared data providers (usually empty).

import type { Bundle, Manifest } from "@wildcard/runtime";

export class ContractError extends Error {}

const APP_RE = /<wc-app\b([^>]*)>([\s\S]*?)<\/wc-app>/i;
const FILE_RE = /```file:([^\n`]+)\n([\s\S]*?)```/g;

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs);
  return m ? m[1].trim() : undefined;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tool"
  );
}

/** Parse a raw model response into a validated Bundle, or throw ContractError. */
export function parseBundle(raw: string, id?: string): Bundle {
  const app = APP_RE.exec(raw);
  if (!app) throw new ContractError("No <wc-app> block found in model output");

  const attrs = app[1];
  const body = app[2];
  const name = attr(attrs, "name") || "Tool";
  const icon = attr(attrs, "icon") || "✨";
  const providersAttr = attr(attrs, "providers") || "";
  const providers = providersAttr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const files: Record<string, string> = {};
  let m: RegExpExecArray | null;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(body))) {
    const path = m[1].trim();
    files[path] = m[2].replace(/\n$/, "");
  }

  if (!files["index.html"]) {
    throw new ContractError("Model output is missing a required index.html file");
  }

  const manifest: Manifest = {
    id: id || slug(name),
    name,
    icon,
    version: 1,
    providers,
  };

  return { manifest, files: files as Bundle["files"] };
}
