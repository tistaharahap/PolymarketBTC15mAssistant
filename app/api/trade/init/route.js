import { getClobContext } from "../../../../src/trading/index.js";
import { ensureTradingEnabled, jsonError, jsonResponse } from "../utils.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = ensureTradingEnabled();
  if (guard) return guard;

  const ctx = await getClobContext();
  if (!ctx) return jsonError("Failed to initialize trading context", 502);

  return jsonResponse({
    ok: true,
    address: ctx.address,
    funderAddress: ctx.funderAddress
  });
}
