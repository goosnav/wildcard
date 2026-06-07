// CMP-07s — the server-side data-provider catalog + proxy logic. Generated tools
// can't reach arbitrary origins (the iframe CSP is `connect-src 'none'`); the ONLY
// network path is WC.net.fetch(provider, params), which the host forwards to the
// server, which forwards to one of these vetted providers. Benefits by
// construction: any upstream API keys stay server-side (REQ-SEC-001), every call
// is loggable/rate-limitable, and a tool can never exfiltrate to an unknown host
// (REQ-RUN-005). The same proxy works identically on web and the future iOS wrap.
//
// v1 ships two KEYLESS providers so live-data tools work with zero setup. To add
// a keyed provider later, read its key from process.env here (never send it down).

const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 256 * 1024; // defensive cap on upstream payload size

export interface ProviderParam {
  name: string;
  type: "number" | "string";
  required: boolean;
  description: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  /** One-line description for the catalog + the generation prompt. */
  description: string;
  params: ProviderParam[];
  /** A representative result shape, shown to the model and used to stub the
   *  validator so live-data tools can be validated offline. */
  sample: unknown;
}

interface Provider extends ProviderInfo {
  fetch(params: Record<string, unknown>): Promise<unknown>;
}

class ProviderError extends Error {}

// --- small upstream fetch helper (timeout + size cap, JSON only) ---

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new ProviderError(`upstream returned ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new ProviderError("upstream payload too large");
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ProviderError("upstream timed out");
    }
    throw new ProviderError(e instanceof Error ? e.message : "upstream request failed");
  } finally {
    clearTimeout(timer);
  }
}

// --- param coercion/validation against a provider's declared params ---

function requireNumber(params: Record<string, unknown>, name: string): number {
  const v = params[name];
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ProviderError(`"${name}" must be a number`);
  }
  return n;
}

function optString(params: Record<string, unknown>, name: string, fallback: string): string {
  const v = params[name];
  if (v == null) return fallback;
  if (typeof v !== "string") throw new ProviderError(`"${name}" must be a string`);
  return v;
}

// --- the catalog ---

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
};

const weather: Provider = {
  id: "weather",
  label: "Weather",
  description:
    "Current weather for a latitude/longitude (Open-Meteo, no key). Returns temperature (°C), humidity (%), wind (km/h), and a human conditions string.",
  params: [
    { name: "latitude", type: "number", required: true, description: "-90 to 90" },
    { name: "longitude", type: "number", required: true, description: "-180 to 180" },
  ],
  sample: {
    temperatureC: 17.4,
    humidity: 62,
    windSpeedKmh: 11.2,
    conditions: "Partly cloudy",
    weatherCode: 2,
    time: "2026-06-07T15:00",
  },
  async fetch(params) {
    const latitude = requireNumber(params, "latitude");
    const longitude = requireNumber(params, "longitude");
    if (latitude < -90 || latitude > 90) throw new ProviderError("latitude out of range");
    if (longitude < -180 || longitude > 180) throw new ProviderError("longitude out of range");
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
    const data = await getJson(url);
    const c = data.current ?? {};
    const code = Number(c.weather_code);
    return {
      temperatureC: c.temperature_2m ?? null,
      humidity: c.relative_humidity_2m ?? null,
      windSpeedKmh: c.wind_speed_10m ?? null,
      conditions: WEATHER_CODES[code] ?? "Unknown",
      weatherCode: Number.isFinite(code) ? code : null,
      time: c.time ?? null,
    };
  },
};

const currency: Provider = {
  id: "currency",
  label: "Currency conversion",
  description:
    "Convert between currencies at the latest published rate (Frankfurter/ECB, no key). Params: from, to (ISO codes like USD, EUR), and optional amount (default 1).",
  params: [
    { name: "from", type: "string", required: true, description: "ISO code, e.g. USD" },
    { name: "to", type: "string", required: true, description: "ISO code, e.g. EUR" },
    { name: "amount", type: "number", required: false, description: "default 1" },
  ],
  sample: { from: "USD", to: "EUR", amount: 1, rate: 0.92, result: 0.92, date: "2026-06-06" },
  async fetch(params) {
    const from = optString(params, "from", "").toUpperCase();
    const to = optString(params, "to", "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(from)) throw new ProviderError('"from" must be a 3-letter ISO code');
    if (!/^[A-Z]{3}$/.test(to)) throw new ProviderError('"to" must be a 3-letter ISO code');
    const amount = params.amount == null ? 1 : requireNumber(params, "amount");
    if (amount <= 0) throw new ProviderError('"amount" must be positive');
    if (from === to) {
      return { from, to, amount, rate: 1, result: amount, date: null };
    }
    const url = `https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`;
    const data = await getJson(url);
    const result = data?.rates?.[to];
    if (typeof result !== "number") throw new ProviderError("unsupported currency pair");
    return { from, to, amount, rate: Number((result / amount).toFixed(6)), result, date: data.date ?? null };
  },
};

const CATALOG: Record<string, Provider> = {
  [weather.id]: weather,
  [currency.id]: currency,
};

/** Public metadata for every provider (no secrets) — for the prompt + a client
 *  catalog endpoint. */
export function providerCatalog(): ProviderInfo[] {
  return Object.values(CATALOG).map(({ fetch: _fetch, ...info }) => info);
}

/** Map of provider id → representative sample, used to stub the validator. */
export function providerSamples(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of Object.values(CATALOG)) out[p.id] = p.sample;
  return out;
}

export function isProvider(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOG, id);
}

export type ProxyResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string };

/** Run a proxied provider call. Returns a tagged result so the route can map it
 *  to an HTTP status without leaking internals. */
export async function callProvider(
  id: string,
  params: Record<string, unknown>
): Promise<ProxyResult> {
  const provider = CATALOG[id];
  if (!provider) return { ok: false, status: 404, error: `unknown provider "${id}"` };
  try {
    return { ok: true, data: await provider.fetch(params ?? {}) };
  } catch (e) {
    // ProviderError = caller/upstream problem (400/502); anything else is a bug.
    if (e instanceof ProviderError) {
      const bad = /must be|out of range|unsupported|required/i.test(e.message);
      return { ok: false, status: bad ? 400 : 502, error: e.message };
    }
    return { ok: false, status: 502, error: "provider request failed" };
  }
}
