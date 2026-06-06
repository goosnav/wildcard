// Core data types for a Wild Card "tool" and the host-side adapters that back
// the Runtime SDK. These are shared between the web host and (later) the iOS
// WebView host — the runtime is built once and embedded everywhere.

export interface Manifest {
  id: string;
  name: string;
  /** Emoji or short string used as the home-grid icon. */
  icon: string;
  version: number;
  /**
   * IDs of server-proxied data providers this tool is allowed to call via
   * WC.net.fetch. A tool may only reach providers it declared here, and only
   * ones the host's catalog actually offers. Empty = fully offline tool.
   */
  providers: string[];
}

/** A self-contained tool. `files` never references code fetched at runtime. */
export interface Bundle {
  manifest: Manifest;
  files: {
    /** Entry point. Required. */
    "index.html": string;
    [path: string]: string;
  };
}

/**
 * Per-app persistent key-value storage (REQ-RUN-003). The host MUST scope every
 * adapter to a single appId so one tool can never read another's data
 * (REQ-RUN-002). In production this is IndexedDB; tests use an in-memory impl.
 */
export interface StorageAdapter {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Network egress for a tool. The host routes every call through a fixed catalog
 * of server-proxied providers — generated code can never reach an arbitrary
 * origin (REQ-RUN-005, REQ-SEC-001). Throws if the provider is not declared in
 * the manifest or not offered by the host.
 */
export interface NetAdapter {
  fetch(provider: string, params: Record<string, unknown>): Promise<unknown>;
}

/** A result a tool handed up via WC.output, for the host to render + export. */
export interface ToolOutput {
  result: unknown;
  meta?: { mime?: string; filename?: string; label?: string };
}

export interface MountOptions {
  bundle: Bundle;
  storage: StorageAdapter;
  net?: NetAdapter;
  /** Called whenever the tool emits a result via WC.output. */
  onOutput?: (output: ToolOutput) => void;
  /** Called on an uncaught error inside the tool (REQ-RUN-007). */
  onError?: (message: string) => void;
}

export interface MountedTool {
  /** The iframe element hosting the tool. */
  frame: HTMLIFrameElement;
  /** Tear down the tool and remove its listeners. */
  destroy(): void;
}
