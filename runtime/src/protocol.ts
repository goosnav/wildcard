// The postMessage protocol spoken between the sandboxed tool (child iframe) and
// the host (parent). The iframe runs at a null origin (sandbox without
// allow-same-origin), so this channel is the ONLY way a tool can touch storage,
// network, or output — which is exactly the containment guarantee we want.

export const WC_MESSAGE = "__wc__" as const;

/** Calls initiated by the tool that expect a host response. */
export type RequestType =
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "storage.keys"
  | "net.fetch";

/** Fire-and-forget signals from the tool to the host. */
export type SignalType = "output" | "error" | "ready";

export interface RequestMessage {
  channel: typeof WC_MESSAGE;
  kind: "request";
  id: number;
  type: RequestType;
  payload: unknown;
}

export interface ResponseMessage {
  channel: typeof WC_MESSAGE;
  kind: "response";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface SignalMessage {
  channel: typeof WC_MESSAGE;
  kind: "signal";
  type: SignalType;
  payload: unknown;
}

export type WcMessage = RequestMessage | ResponseMessage | SignalMessage;

export function isWcMessage(data: unknown): data is WcMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { channel?: unknown }).channel === WC_MESSAGE
  );
}
