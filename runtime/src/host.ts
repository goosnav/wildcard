import { buildSdkSource } from "./sdk";
import { isWcMessage, RequestType, WC_MESSAGE } from "./protocol";
import { Bundle, MountedTool, MountOptions } from "./types";

/**
 * Content Security Policy applied inside every tool frame. The hard isolation
 * comes from the iframe `sandbox` attribute (null origin, no parent access);
 * this CSP is defense-in-depth that (a) blocks ALL direct network egress
 * (`connect-src 'none'`) so the only network path is the host-proxied WC.net,
 * and (b) blocks loading any external/remote code or resources, enforcing the
 * "self-contained, no runtime code fetch" rule (Apple 2.5.2 / REQ-RUN-005).
 */
const TOOL_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob:; " +
  "font-src data:; " +
  "media-src data: blob:; " +
  "connect-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'";

/**
 * Wrap a tool's index.html into a sandboxed document: inject the CSP meta tag
 * and the Runtime SDK so `WC` exists before any tool script runs.
 */
export function composeSrcdoc(bundle: Bundle): string {
  const sdk = buildSdkSource(JSON.stringify(bundle.manifest));
  const inject =
    `<meta http-equiv="Content-Security-Policy" content="${TOOL_CSP}">` +
    `<script>${sdk}</script>`;

  const html = bundle.files["index.html"];
  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + inject + html.slice(at);
  }
  const htmlOpen = /<html[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + "<head>" + inject + "</head>" + html.slice(at);
  }
  return `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
}

/**
 * Mount a tool into `container`. Each call creates an isolated frame; the host
 * scopes storage/net per-tool so no tool can observe another (REQ-RUN-002).
 */
export function mountTool(
  container: HTMLElement,
  opts: MountOptions
): MountedTool {
  const { bundle, storage, net, onOutput, onError } = opts;

  const frame = document.createElement("iframe");
  // allow-scripts WITHOUT allow-same-origin => unique null origin: the tool
  // cannot touch parent DOM, cookies, or localStorage. This is the containment.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.style.cssText = "width:100%;height:100%;border:0;display:block";
  frame.srcdoc = composeSrcdoc(bundle);

  async function handleRequest(type: RequestType, payload: any): Promise<unknown> {
    switch (type) {
      case "storage.get":
        return storage.get(payload.key);
      case "storage.set":
        return storage.set(payload.key, payload.value);
      case "storage.remove":
        return storage.remove(payload.key);
      case "storage.keys":
        return storage.keys();
      case "net.fetch": {
        if (!net) throw new Error("Network is not available for this tool");
        if (bundle.manifest.providers.indexOf(payload.provider) === -1) {
          throw new Error(`Provider "${payload.provider}" not declared`);
        }
        return net.fetch(payload.provider, payload.params);
      }
      default:
        throw new Error(`Unknown request: ${type}`);
    }
  }

  const onMessage = (event: MessageEvent) => {
    // Only accept messages from THIS tool's frame.
    if (event.source !== frame.contentWindow) return;
    const msg = event.data;
    if (!isWcMessage(msg)) return;
    const target = frame.contentWindow;
    if (!target) return;

    if (msg.kind === "request") {
      handleRequest(msg.type, msg.payload).then(
        (result) =>
          target.postMessage(
            { channel: WC_MESSAGE, kind: "response", id: msg.id, ok: true, result },
            "*"
          ),
        (err) =>
          target.postMessage(
            {
              channel: WC_MESSAGE,
              kind: "response",
              id: msg.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            "*"
          )
      );
    } else if (msg.kind === "signal") {
      if (msg.type === "output") onOutput?.(msg.payload as any);
      else if (msg.type === "error") onError?.((msg.payload as any)?.message ?? "Error");
    }
  };

  window.addEventListener("message", onMessage);
  container.appendChild(frame);

  return {
    frame,
    destroy() {
      window.removeEventListener("message", onMessage);
      frame.remove();
    },
  };
}
