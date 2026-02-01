import { fetchCollateralBalance } from "../../../../src/trading/index.js";
import { ensureTradingEnabled, jsonError, jsonResponse } from "../utils.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = ensureTradingEnabled();
  if (guard) return guard;

  const balance = await fetchCollateralBalance();
  if (!balance) return jsonError("Failed to fetch balance", 502);
  return jsonResponse(balance);
}
