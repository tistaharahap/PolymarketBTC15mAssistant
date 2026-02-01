import { fetchOrder } from "../../../../src/trading/index.js";
import {
  ensureTradingEnabled,
  jsonError,
  jsonResponse,
  parseString
} from "../utils.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const guard = ensureTradingEnabled();
  if (guard) return guard;

  const url = new URL(req.url);
  const orderId = parseString(url.searchParams.get("orderId"), "orderId");
  if (orderId.error) return jsonError(orderId.error);

  const order = await fetchOrder(orderId.value);
  if (!order) return jsonError("Order not found", 404);
  return jsonResponse(order);
}
