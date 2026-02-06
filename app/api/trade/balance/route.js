import { fetchCollateralBalance, fetchConditionalBalance } from "../../../../src/trading/index.js";
import { ensureTradingEnabled, jsonError, jsonResponse } from "../utils.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const guard = ensureTradingEnabled();
  if (guard) return guard;

  const url = new URL(req.url);
  const tokenId = String(url.searchParams.get("tokenId") ?? "").trim();
  if (tokenId) {
    const balance = await fetchConditionalBalance(tokenId);
    if (!balance) return jsonError("Failed to fetch conditional balance", 502);
    return jsonResponse({
      tokenId,
      assetType: "CONDITIONAL",
      ...balance
    });
  }

  const balance = await fetchCollateralBalance();
  if (!balance) return jsonError("Failed to fetch balance", 502);
  return jsonResponse({
    assetType: "COLLATERAL",
    ...balance
  });
}
