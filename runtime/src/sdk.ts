import { WC_MESSAGE } from "./protocol";

/**
 * Returns the JavaScript source for the Runtime SDK that is injected into every
 * tool's sandboxed iframe as the global `WC`. It is authored as a stringified
 * IIFE because it executes inside the child frame (null origin), where it can
 * only reach the host through postMessage.
 *
 * The surface here is FIXED at host build time and is not negotiable by tool
 * content (REQ-SEC-005). If a tool wants something not on `WC`, it cannot have
 * it.
 */
export function buildSdkSource(manifestJson: string): string {
  // NOTE: everything inside the backtick template runs in the iframe. Keep it
  // dependency-free and ES2017-compatible.
  return `(function () {
  "use strict";
  var CHANNEL = ${JSON.stringify(WC_MESSAGE)};
  var manifest = ${manifestJson};
  var seq = 0;
  var pending = Object.create(null);

  function request(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage(
        { channel: CHANNEL, kind: "request", id: id, type: type, payload: payload },
        "*"
      );
    });
  }

  function signal(type, payload) {
    parent.postMessage(
      { channel: CHANNEL, kind: "signal", type: type, payload: payload },
      "*"
    );
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.channel !== CHANNEL || msg.kind !== "response") return;
    var p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "WC request failed"));
  });

  // Surface uncaught tool errors to the host so a broken tool degrades to a
  // friendly state instead of a dead frame (REQ-RUN-007).
  window.addEventListener("error", function (e) {
    signal("error", { message: String(e.message || e.error || "Unknown error") });
  });
  window.addEventListener("unhandledrejection", function (e) {
    signal("error", { message: String((e.reason && e.reason.message) || e.reason) });
  });

  var WC = {
    meta: Object.freeze({ appId: manifest.id, version: manifest.version }),

    storage: {
      get: function (key) { return request("storage.get", { key: key }); },
      set: function (key, value) { return request("storage.set", { key: key, value: value }); },
      remove: function (key) { return request("storage.remove", { key: key }); },
      keys: function () { return request("storage.keys", {}); }
    },

    // The ONLY sanctioned way for a tool to produce a shareable result. The host
    // renders it and owns the Share/Export affordance (REQ-RUN-004). Tool code
    // never calls a native/file API itself.
    output: function (result, meta) {
      signal("output", { result: result, meta: meta || null });
    },

    net: {
      // Only providers declared in the manifest AND offered by the host resolve;
      // anything else rejects. Generated code cannot reach arbitrary origins.
      fetch: function (provider, params) {
        if (manifest.providers.indexOf(provider) === -1) {
          return Promise.reject(
            new Error('Provider "' + provider + '" not declared in manifest')
          );
        }
        return request("net.fetch", { provider: provider, params: params || {} });
      }
    },

    ui: {
      toast: function (message) {
        // Pure in-frame UI; no native escalation.
        var el = document.createElement("div");
        el.textContent = String(message);
        el.setAttribute("role", "status");
        el.style.cssText =
          "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
          "background:#111;color:#fff;padding:10px 16px;border-radius:999px;" +
          "font:14px system-ui;z-index:99999;opacity:0;transition:opacity .15s";
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.style.opacity = "1"; });
        setTimeout(function () {
          el.style.opacity = "0";
          setTimeout(function () { el.remove(); }, 200);
        }, 1800);
      }
    }
  };

  Object.defineProperty(window, "WC", { value: Object.freeze(WC), writable: false });
  signal("ready", {});
})();`;
}
