import {
  fetchCollateralBalance,
  fetchConditionalBalance,
  fetchOrderFills,
  placeLimitOrder,
  placeMarketOrder
} from "../../../../src/trading/index.js";
import { logger } from "../../../../src/trading/logger.js";
import {
  ensureTradingEnabled,
  isBelowMin,
  jsonError,
  jsonResponse,
  parseNumber,
  parseOrderType,
  parseSide,
  parseString,
  parseBool,
  parseTickSize
} from "../utils.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MIN_ORDER_NOTIONAL_USD = 1;
const MIN_ORDER_SHARES = 5;
const MIN_TRADABLE_PRICE = 0.01;
const MAX_TRADABLE_PRICE = 0.99;

function floorTo(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** decimals;
  return Math.floor((n + 1e-9) * factor) / factor;
}

function minSellSharesAtPrice(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return MIN_ORDER_SHARES;
  return Math.max(MIN_ORDER_SHARES, MIN_ORDER_NOTIONAL_USD / p);
}

function adjustSellAmountToAvoidDust(requestedAmount, availableAmount, price) {
  const requested = Number(requestedAmount);
  const available = Number(availableAmount);
  if (!Number.isFinite(requested) || !Number.isFinite(available)) return requested;
  let next = Math.min(requested, available);
  const remaining = available - next;
  const minSellShares = minSellSharesAtPrice(price);
  if (remaining > 0 && isBelowMin(remaining, minSellShares)) {
    next = available;
  }
  return next;
}

function sharesFromAmount(amount, price) {
  const a = Number(amount);
  const p = Number(price);
  if (!Number.isFinite(a) || !Number.isFinite(p) || p <= 0) return null;
  return a / p;
}

function isOutOfTradablePriceRange(price) {
  const p = Number(price);
  return isBelowMin(p, MIN_TRADABLE_PRICE) || p > (MAX_TRADABLE_PRICE + 1e-9);
}

export async function POST(req) {
  const guard = ensureTradingEnabled();
  if (guard) return guard;

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const tokenId = parseString(body?.tokenId, "tokenId");
  if (tokenId.error) return jsonError(tokenId.error);

  const side = parseSide(body?.side);
  if (side.error) return jsonError(side.error);

  const price = parseNumber(body?.price, "price", { min: 0, allowZero: false });
  if (price.error) return jsonError(price.error);

  const useMarket = body?.market === true || String(body?.orderKind ?? "").toLowerCase() === "market";
  if (useMarket && isOutOfTradablePriceRange(price.value)) {
    return jsonError(`price out of tradable range ($${MIN_TRADABLE_PRICE.toFixed(2)}-$${MAX_TRADABLE_PRICE.toFixed(2)})`, 409, {
      price: price.value,
      minTradablePrice: MIN_TRADABLE_PRICE,
      maxTradablePrice: MAX_TRADABLE_PRICE
    });
  }

  let size = null;
  if (!useMarket) {
    const parsed = parseNumber(body?.size, "size", { min: 0, allowZero: false });
    if (parsed.error) return jsonError(parsed.error);
    size = parsed.value;
  }

  let amount = null;
  if (useMarket) {
    const parsed = parseNumber(body?.amount, "amount", { min: 0, allowZero: false });
    if (parsed.error) return jsonError(parsed.error);
    amount = parsed.value;
  }

  const orderType = parseOrderType(body?.orderType, undefined);
  if (orderType.error) return jsonError(orderType.error);

  let tickSize = null;
  if (body?.tickSize !== undefined && body?.tickSize !== null) {
    const parsed = parseTickSize(body.tickSize);
    if (parsed.error) return jsonError(parsed.error);
    tickSize = parsed.value;
  }

  let negRisk = null;
  if (body?.negRisk !== undefined && body?.negRisk !== null) {
    const parsed = parseBool(body.negRisk, "negRisk");
    if (parsed.error) return jsonError(parsed.error);
    negRisk = parsed.value;
  }

  const postOnly = body?.postOnly === true;
  const awaitFill = body?.awaitFill === true;
  let maxWaitMs = null;
  let pollIntervalMs = null;
  if (body?.maxWaitMs !== undefined && body?.maxWaitMs !== null) {
    const parsed = parseNumber(body.maxWaitMs, "maxWaitMs", { min: 0, allowZero: true });
    if (parsed.error) return jsonError(parsed.error);
    maxWaitMs = parsed.value;
  }
  if (body?.pollIntervalMs !== undefined && body?.pollIntervalMs !== null) {
    const parsed = parseNumber(body.pollIntervalMs, "pollIntervalMs", { min: 0, allowZero: true });
    if (parsed.error) return jsonError(parsed.error);
    pollIntervalMs = parsed.value;
  }

  if (!useMarket) {
    if (isBelowMin(size, MIN_ORDER_SHARES)) {
      return jsonError(`order size must be >= ${MIN_ORDER_SHARES} shares`, 409, {
        requestedSize: size
      });
    }
    const limitNotional = size * price.value;
    if (isBelowMin(limitNotional, MIN_ORDER_NOTIONAL_USD)) {
      return jsonError(`order notional must be >= $${MIN_ORDER_NOTIONAL_USD}`, 409, {
        requestedSize: size,
        price: price.value,
        notional: limitNotional
      });
    }
  }

  const result = useMarket
    ? await (async () => {
        let submitAmount = amount;
        let available = null;
        let availableAssetType = null;
        if (side.value === "SELL") {
          const conditional = await fetchConditionalBalance(tokenId.value);
          if (!conditional) {
            return { error: "failed to fetch conditional balance", status: 502 };
          }
          available = conditional.available;
          availableAssetType = "CONDITIONAL";
          submitAmount = floorTo(
            adjustSellAmountToAvoidDust(amount, available, price.value),
            2
          );
          if (!Number.isFinite(submitAmount) || submitAmount <= 0) {
            return {
              error: "not enough balance / allowance",
              status: 409,
              requestedAmount: amount,
              submittedAmount: submitAmount,
              available,
              availableAssetType
            };
          }
          if (isBelowMin(submitAmount, MIN_ORDER_SHARES)) {
            return {
              error: `order size must be >= ${MIN_ORDER_SHARES} shares`,
              status: 409,
              requestedAmount: amount,
              submittedAmount: submitAmount,
              available,
              availableAssetType
            };
          }
          const sellNotional = submitAmount * price.value;
          if (isBelowMin(sellNotional, MIN_ORDER_NOTIONAL_USD)) {
            return {
              error: `order notional must be >= $${MIN_ORDER_NOTIONAL_USD}`,
              status: 409,
              requestedAmount: amount,
              submittedAmount: submitAmount,
              available,
              availableAssetType
            };
          }
        } else if (side.value === "BUY") {
          const collateral = await fetchCollateralBalance();
          if (!collateral) {
            return { error: "failed to fetch collateral balance", status: 502 };
          }
          available = collateral.available;
          availableAssetType = "COLLATERAL";
          submitAmount = floorTo(Math.min(amount, available), 2);
          if (isBelowMin(submitAmount, MIN_ORDER_NOTIONAL_USD)) {
            return {
              error: `invalid amount for a marketable BUY order (min size: $${MIN_ORDER_NOTIONAL_USD}) or insufficient collateral`,
              status: 409,
              requestedAmount: amount,
              submittedAmount: submitAmount,
              available,
              availableAssetType
            };
          }
          const submitShares = submitAmount / price.value;
          if (isBelowMin(submitShares, MIN_ORDER_SHARES)) {
            return {
              error: `order size must be >= ${MIN_ORDER_SHARES} shares`,
              status: 409,
              requestedAmount: amount,
              submittedAmount: submitAmount,
              requestedShares: amount / price.value,
              submittedShares: submitShares,
              available,
              availableAssetType
            };
          }
        }

        const placed = await placeMarketOrder({
          tokenId: tokenId.value,
          amount: submitAmount,
          side: side.value,
          orderType: orderType.value,
          price: price.value,
          tickSize,
          negRisk,
          returnError: true
        });
        return {
          ...placed,
          requestedAmount: amount,
          submittedAmount: submitAmount,
          available,
          availableAssetType
        };
      })()
    : await placeLimitOrder({
        tokenId: tokenId.value,
        price: price.value,
        size,
        side: side.value,
        orderType: orderType.value,
        tickSize,
        negRisk,
        postOnly,
        returnError: true
      });

  if (!result) return jsonError("Order submission failed", 502);
  if (result.error) {
    const statusCode = Number.isInteger(result.status) ? result.status : 502;
    const requestedShares = Number.isFinite(result.requestedShares)
      ? result.requestedShares
      : (side.value === "BUY" ? sharesFromAmount(result.requestedAmount, price.value) : result.requestedAmount);
    const submittedShares = Number.isFinite(result.submittedShares)
      ? result.submittedShares
      : (side.value === "BUY" ? sharesFromAmount(result.submittedAmount, price.value) : result.submittedAmount);
    if (statusCode === 409) {
      logger.warn(
        "[trade/limit] 409 %s token=%s side=%s assetType=%s price=%s requestedUsd=%s submittedUsd=%s requestedShares=%s submittedShares=%s available=%s",
        result.error,
        tokenId.value,
        side.value,
        result.availableAssetType ?? "unknown",
        price.value,
        side.value === "BUY" ? (result.requestedAmount ?? "n/a") : "n/a",
        side.value === "BUY" ? (result.submittedAmount ?? "n/a") : "n/a",
        requestedShares ?? "n/a",
        submittedShares ?? "n/a",
        result.available ?? "n/a"
      );
    }
    return jsonError(result.error, statusCode, {
      available: result.available ?? null,
      availableAssetType: result.availableAssetType ?? null,
      requestedAmount: result.requestedAmount ?? null,
      submittedAmount: result.submittedAmount ?? null,
      requestedShares: requestedShares ?? null,
      submittedShares: submittedShares ?? null,
      minOrderShares: MIN_ORDER_SHARES,
      minOrderNotionalUsd: MIN_ORDER_NOTIONAL_USD
    });
  }
  const requestedShares = Number.isFinite(result.requestedShares)
    ? result.requestedShares
    : (side.value === "BUY" ? sharesFromAmount(result.requestedAmount, price.value) : result.requestedAmount);
  const submittedShares = Number.isFinite(result.submittedShares)
    ? result.submittedShares
    : (side.value === "BUY" ? sharesFromAmount(result.submittedAmount, price.value) : result.submittedAmount);
  if (!awaitFill) {
    return jsonResponse({
      orderId: result.orderId,
      status: result.status,
      requestedAmount: result.requestedAmount ?? null,
      submittedAmount: result.submittedAmount ?? null,
      requestedShares: requestedShares ?? null,
      submittedShares: submittedShares ?? null,
      available: result.available ?? null,
      availableAssetType: result.availableAssetType ?? null
    });
  }

  const fills = await fetchOrderFills(result.orderId, {
    maxWaitMs: maxWaitMs ?? 60000,
    pollIntervalMs: pollIntervalMs ?? 1500,
    preferTrades: useMarket
  });
  if (!fills) {
    return jsonResponse({ orderId: result.orderId, status: result.status, filledSize: 0, avgPrice: null });
  }
  return jsonResponse({
    orderId: result.orderId,
    status: fills.status ?? result.status,
    filledSize: fills.filledSize ?? 0,
    avgPrice: fills.avgPrice ?? null,
    trades: fills.trades ?? [],
    requestedAmount: result.requestedAmount ?? null,
    submittedAmount: result.submittedAmount ?? null,
    requestedShares: requestedShares ?? null,
    submittedShares: submittedShares ?? null,
    available: result.available ?? null,
    availableAssetType: result.availableAssetType ?? null
  });
}
