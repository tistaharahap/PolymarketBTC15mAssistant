import { TRADING_CONFIG } from "../../../src/trading/config.js";
import { OrderType, Side } from "../../../src/trading/index.js";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};
const NUMERIC_EPSILON = 1e-9;

export function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export function jsonError(message, status = 400, details) {
  return jsonResponse(
    { error: message, ...(details ? { details } : {}) },
    status
  );
}

export function ensureTradingEnabled() {
  if (!TRADING_CONFIG.enabled) {
    return jsonError("Trading disabled (set TRADING_ENABLED=true).", 403);
  }
  if (!TRADING_CONFIG.privateKey) {
    return jsonError("POLY_PRIVATE_KEY is required for trading.", 403);
  }
  return null;
}

export function parseString(value, label) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return { error: `${label} is required` };
  return { value: v };
}

export function parseNumber(value, label, { min = 0, allowZero = false } = {}) {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : Number(value);
  if (!Number.isFinite(num)) return { error: `${label} must be a number` };
  if (allowZero ? num < min : num <= min) return { error: `${label} must be > ${min}` };
  return { value: num };
}

export function isBelowMin(value, min, epsilon = NUMERIC_EPSILON) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isFinite(Number(min))) return true;
  return numeric + epsilon < Number(min);
}

export function parseBool(value, label) {
  if (typeof value === "boolean") return { value };
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return { value: true };
    if (v === "false") return { value: false };
  }
  return { error: `${label} must be true or false` };
}

export function parseTickSize(value) {
  const allowed = ["0.1", "0.01", "0.001", "0.0001"];
  const v = value === undefined || value === null ? "" : String(value).trim();
  if (!v) return { error: "tickSize is required" };
  if (!allowed.includes(v)) {
    return { error: `tickSize must be one of ${allowed.join(", ")}` };
  }
  return { value: v };
}

export function parseSide(value) {
  if (!value) return { error: "side is required" };
  const v = String(value).toUpperCase();
  if (!Object.values(Side).includes(v)) {
    return { error: "side must be BUY or SELL" };
  }
  return { value: v };
}

export function parseOrderType(value, fallback) {
  if (!value) return { value: fallback };
  const v = String(value).toUpperCase();
  if (!Object.values(OrderType).includes(v)) {
    return { error: `orderType must be one of ${Object.values(OrderType).join(", ")}` };
  }
  return { value: v };
}
