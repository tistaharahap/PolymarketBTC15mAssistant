"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, LineSeries, createSeriesMarkers } from "lightweight-charts";
import { connectClobMarketWs } from "../_ws/clobMarket";

const TAB_ORDER = [
  { asset: "btc", label: "BTC" },
  { asset: "eth", label: "ETH" },
  { asset: "xrp", label: "XRP" },
  { asset: "sol", label: "SOL" }
];

const RATIO_POINTS_LIMIT = 1200;
const MAX_BUY_PRICE = 0.99;
const MIN_BUY_PRICE = 0.01;
const DEFAULT_END_CLAMP_SEC = 120;

function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtUsd(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return `$${fmtNum(n, digits)}`;
}

function fmtRatio(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return `${fmtNum(n, digits)}x`;
}

function fmtTimeLeftSec(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  const total = Math.max(0, Math.floor(Number(value)));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buyPayoutRatio(price) {
  if (!Number.isFinite(price) || price <= 0) return null;
  return (1 - price) / price;
}

function sellPayoutRatio(price) {
  if (!Number.isFinite(price) || price >= 1) return null;
  return price / (1 - price);
}

function appendPoint(series, point) {
  if (!point || !Number.isFinite(point.time) || !Number.isFinite(point.value)) return series;
  const next = series.length ? [...series] : [];
  const last = next[next.length - 1];
  if (last && last.time === point.time) {
    next[next.length - 1] = point;
  } else {
    next.push(point);
  }
  if (next.length > RATIO_POINTS_LIMIT) {
    next.splice(0, next.length - RATIO_POINTS_LIMIT);
  }
  return next;
}

function computeMomentum(series, windowSec) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const last = series[series.length - 1];
  if (!last) return null;
  const cutoff = last.time - windowSec;
  let anchor = null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const point = series[i];
    if (point.time <= cutoff) {
      anchor = point;
      break;
    }
  }
  if (!anchor) anchor = series[0];
  const dt = Math.max(1, last.time - anchor.time);
  return (last.value - anchor.value) / dt;
}

function RatioChart({ series, markers }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const upBuyRef = useRef(null);
  const upSellRef = useRef(null);
  const downBuyRef = useRef(null);
  const downSellRef = useRef(null);
  const upBuyMarkersRef = useRef(null);
  const upSellMarkersRef = useRef(null);
  const downBuyMarkersRef = useRef(null);
  const downSellMarkersRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue("--text").trim() || "#e9eef9";
    const border = styles.getPropertyValue("--border").trim() || "#1b2a44";
    const muted = styles.getPropertyValue("--muted").trim() || "#a5b4d0";
    const green = styles.getPropertyValue("--green").trim() || "#45ffb2";
    const cyan = styles.getPropertyValue("--cyan").trim() || "#59d7ff";
    const amber = styles.getPropertyValue("--amber").trim() || "#ffcc66";
    const red = styles.getPropertyValue("--red").trim() || "#ff5c7a";

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" },
        textColor: text,
        attributionLogo: false
      },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border }
      },
      rightPriceScale: { borderColor: border },
      timeScale: {
        borderColor: border,
        rightOffset: 2,
        timeVisible: true,
        secondsVisible: true
      },
      crosshair: {
        horzLine: { color: muted },
        vertLine: { color: muted }
      }
    });

    const upBuy = chart.addSeries(LineSeries, { color: green, lineWidth: 2 });
    const upSell = chart.addSeries(LineSeries, { color: cyan, lineWidth: 2 });
    const downBuy = chart.addSeries(LineSeries, { color: amber, lineWidth: 2 });
    const downSell = chart.addSeries(LineSeries, { color: red, lineWidth: 2 });

    const upBuyMarkers = createSeriesMarkers(upBuy);
    const upSellMarkers = createSeriesMarkers(upSell);
    const downBuyMarkers = createSeriesMarkers(downBuy);
    const downSellMarkers = createSeriesMarkers(downSell);

    chartRef.current = chart;
    upBuyRef.current = upBuy;
    upSellRef.current = upSell;
    downBuyRef.current = downBuy;
    downSellRef.current = downSell;
    upBuyMarkersRef.current = upBuyMarkers;
    upSellMarkersRef.current = upSellMarkers;
    downBuyMarkersRef.current = downBuyMarkers;
    downSellMarkersRef.current = downSellMarkers;

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      upBuyMarkersRef.current?.detach?.();
      upSellMarkersRef.current?.detach?.();
      downBuyMarkersRef.current?.detach?.();
      downSellMarkersRef.current?.detach?.();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    upBuyRef.current?.setData(series.upBuy ?? []);
    upSellRef.current?.setData(series.upSell ?? []);
    downBuyRef.current?.setData(series.downBuy ?? []);
    downSellRef.current?.setData(series.downSell ?? []);
  }, [series]);

  useEffect(() => {
    upBuyMarkersRef.current?.setMarkers(markers.upBuy ?? []);
    upSellMarkersRef.current?.setMarkers(markers.upSell ?? []);
    downBuyMarkersRef.current?.setMarkers(markers.downBuy ?? []);
    downSellMarkersRef.current?.setMarkers(markers.downSell ?? []);
  }, [markers]);

  return <div className="chartCanvas" ref={containerRef} />;
}

export default function TrendSizingPage() {
  const [activeAsset, setActiveAsset] = useState("btc");
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [clobByAsset, setClobByAsset] = useState({});
  const clobRef = useRef(null);

  const [simEnabled, setSimEnabled] = useState(true);
  const [buyRatioMin, setBuyRatioMin] = useState(8);
  const [sellRatioMin, setSellRatioMin] = useState(20);
  const [momentumWindowSec, setMomentumWindowSec] = useState(15);
  const [minMomentum, setMinMomentum] = useState(0);
  const [baseSize, setBaseSize] = useState(10);
  const [maxSize, setMaxSize] = useState(200);
  const [sizeScale, setSizeScale] = useState(1);
  const [cooldownSec, setCooldownSec] = useState(5);
  const [hedgeEnabled, setHedgeEnabled] = useState(true);
  const [hedgeRatioMin, setHedgeRatioMin] = useState(0);
  const [hedgeRatioMax, setHedgeRatioMax] = useState(1);
  const [hedgeSizeMult, setHedgeSizeMult] = useState(1);
  const [winnerBuyMinPrice, setWinnerBuyMinPrice] = useState(0.8);
  const [winnerBuyRequireFavored, setWinnerBuyRequireFavored] = useState(true);
  const [endClampLoserBuySec, setEndClampLoserBuySec] = useState(DEFAULT_END_CLAMP_SEC);
  const [endClampWinnerSellSec, setEndClampWinnerSellSec] = useState(DEFAULT_END_CLAMP_SEC);
  const [enableUpBuy, setEnableUpBuy] = useState(false);
  const [enableUpSell, setEnableUpSell] = useState(true);
  const [enableDownBuy, setEnableDownBuy] = useState(true);
  const [enableDownSell, setEnableDownSell] = useState(false);

  const [ratioSeries, setRatioSeries] = useState({ upBuy: [], upSell: [], downBuy: [], downSell: [] });
  const ratioSeriesRef = useRef(ratioSeries);

  const [trades, setTrades] = useState([]);
  const lastTradeRef = useRef({});
  const positionsRef = useRef({ Up: 0, Down: 0 });
  const [positions, setPositions] = useState({ Up: 0, Down: 0 });
  const [timeLeftSec, setTimeLeftSec] = useState(null);
  const timeLeftRef = useRef(null);

  const activeTokens = meta?.polymarket?.tokens ?? null;
  const activeMarketSlug = meta?.polymarket?.marketSlug ?? null;

  const activeBbo = clobByAsset[activeAsset] ?? { marketSlug: null, up: null, down: null };
  const upBid = activeBbo?.up?.bid ?? null;
  const upAsk = activeBbo?.up?.ask ?? null;
  const downBid = activeBbo?.down?.bid ?? null;
  const downAsk = activeBbo?.down?.ask ?? null;

  const upBuyRatio = useMemo(() => buyPayoutRatio(upAsk), [upAsk]);
  const upSellRatio = useMemo(() => sellPayoutRatio(upBid), [upBid]);
  const downBuyRatio = useMemo(() => buyPayoutRatio(downAsk), [downAsk]);
  const downSellRatio = useMemo(() => sellPayoutRatio(downBid), [downBid]);

  const upBuyMomentum = useMemo(() => computeMomentum(ratioSeries.upBuy, momentumWindowSec), [ratioSeries.upBuy, momentumWindowSec]);
  const upSellMomentum = useMemo(() => computeMomentum(ratioSeries.upSell, momentumWindowSec), [ratioSeries.upSell, momentumWindowSec]);
  const downBuyMomentum = useMemo(() => computeMomentum(ratioSeries.downBuy, momentumWindowSec), [ratioSeries.downBuy, momentumWindowSec]);
  const downSellMomentum = useMemo(() => computeMomentum(ratioSeries.downSell, momentumWindowSec), [ratioSeries.downSell, momentumWindowSec]);

  useEffect(() => {
    ratioSeriesRef.current = ratioSeries;
  }, [ratioSeries]);

  useEffect(() => {
    let alive = true;
    let rolloverTimer = null;

    const clearTimers = () => {
      if (rolloverTimer) clearTimeout(rolloverTimer);
      rolloverTimer = null;
    };

    const scheduleRollover = (endTime) => {
      clearTimers();
      if (!endTime) return;
      const endMs = new Date(endTime).getTime();
      if (!Number.isFinite(endMs)) return;
      const delay = Math.max(0, endMs - Date.now());
      rolloverTimer = setTimeout(() => {
        loadMeta();
      }, delay);
    };

    async function loadMeta() {
      setMetaLoading(true);
      setMetaErr(null);
      try {
        const res = await fetch(`/api/snapshot?asset=${encodeURIComponent(activeAsset)}`, { cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
        if (!alive) return;
        setMeta(j);
        scheduleRollover(j?.polymarket?.marketEndTime ?? null);
      } catch (err) {
        if (!alive) return;
        setMetaErr(err?.message ?? String(err));
      } finally {
        if (!alive) return;
        setMetaLoading(false);
      }
    }

    loadMeta();
    return () => {
      alive = false;
      clearTimers();
    };
  }, [activeAsset]);

  useEffect(() => {
    const upTokenId = activeTokens?.upTokenId ?? null;
    const downTokenId = activeTokens?.downTokenId ?? null;

    setClobByAsset((prev) => ({
      ...prev,
      [activeAsset]: {
        marketSlug: activeMarketSlug,
        up: null,
        down: null
      }
    }));

    const ids = [upTokenId, downTokenId].filter(Boolean);
    if (!ids.length) {
      clobRef.current?.close?.();
      clobRef.current = null;
      return;
    }

    clobRef.current?.close?.();

    const c = connectClobMarketWs({
      assetIds: ids,
      onBestBidAsk: ({ assetId, bestBid, bestAsk }) => {
        setClobByAsset((prev) => {
          const cur = prev[activeAsset] ?? { marketSlug: activeMarketSlug, up: null, down: null };
          const next = { ...cur, marketSlug: activeMarketSlug };
          if (assetId === String(upTokenId)) next.up = { bid: bestBid, ask: bestAsk };
          if (assetId === String(downTokenId)) next.down = { bid: bestBid, ask: bestAsk };
          return { ...prev, [activeAsset]: next };
        });
      }
    });

    clobRef.current = c;
    return () => c?.close?.();
  }, [activeAsset, activeMarketSlug, activeTokens?.upTokenId, activeTokens?.downTokenId]);

  useEffect(() => {
    const askBidReady = [upAsk, upBid, downAsk, downBid].every((v) => Number.isFinite(v));
    if (!askBidReady) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const next = {
      upBuy: appendPoint(ratioSeriesRef.current.upBuy ?? [], { time: nowSec, value: upBuyRatio }),
      upSell: appendPoint(ratioSeriesRef.current.upSell ?? [], { time: nowSec, value: upSellRatio }),
      downBuy: appendPoint(ratioSeriesRef.current.downBuy ?? [], { time: nowSec, value: downBuyRatio }),
      downSell: appendPoint(ratioSeriesRef.current.downSell ?? [], { time: nowSec, value: downSellRatio })
    };

    const endMs = meta?.polymarket?.marketEndTime ? new Date(meta.polymarket.marketEndTime).getTime() : null;
    const nextTimeLeft = Number.isFinite(endMs) ? Math.max(0, Math.floor((endMs - Date.now()) / 1000)) : null;
    if (nextTimeLeft !== timeLeftRef.current) {
      timeLeftRef.current = nextTimeLeft;
      setTimeLeftSec(nextTimeLeft);
    }

    ratioSeriesRef.current = next;
    setRatioSeries(next);

    if (!simEnabled) return;

    const sizeFromRatio = (ratio, threshold, side, outcome) => {
      if (!Number.isFinite(ratio) || !Number.isFinite(threshold) || threshold <= 0) return baseSize;
      const multiplier = Math.max(1, ratio / threshold);
      const sized = baseSize * Math.pow(multiplier, sizeScale);
      const capped = Math.min(maxSize, Math.max(0, sized));
      if (side === "SELL") {
        const available = positionsRef.current[outcome] ?? 0;
        return Math.max(0, Math.min(capped, available));
      }
      return capped;
    };

    const shouldTrade = (key) => {
      const last = lastTradeRef.current[key] ?? 0;
      return nowSec - last >= cooldownSec;
    };

    const favoredOutcome = Number.isFinite(upAsk) && Number.isFinite(downAsk)
      ? (upAsk >= downAsk ? "Up" : "Down")
      : null;
    const inLoserBuyClamp = Number.isFinite(nextTimeLeft) && nextTimeLeft <= endClampLoserBuySec;
    const inWinnerHold = Number.isFinite(nextTimeLeft) && nextTimeLeft <= endClampWinnerSellSec;

    const recordTrade = ({ outcome, side, price, ratio, momentum, threshold, reason, isHedge = false, hedgeOf = null, sizeOverride = null }) => {
      const size = sizeOverride ?? sizeFromRatio(ratio, threshold, side, outcome);
      if (!Number.isFinite(size) || size <= 0) return;
      const delta = side === "BUY" ? size : -size;
      const nextPos = {
        ...positionsRef.current,
        [outcome]: (positionsRef.current[outcome] ?? 0) + delta
      };
      positionsRef.current = nextPos;
      setPositions(nextPos);
      const entry = {
        id: `${nowSec}-${outcome}-${side}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        time: nowSec,
        asset: activeAsset,
        outcome,
        side,
        price,
        ratio,
        momentum,
        size,
        threshold,
        reason,
        positionAfter: nextPos[outcome],
        isHedge,
        hedgeOf
      };
      setTrades((prev) => [entry, ...prev].slice(0, 2000));
      return entry;
    };

    const signals = [
      {
        key: "up-buy",
        enabled: enableUpBuy,
        outcome: "Up",
        side: "BUY",
        price: upAsk,
        ratio: upBuyRatio,
        momentum: computeMomentum(next.upBuy, momentumWindowSec),
        threshold: buyRatioMin,
        minMomentum
      },
      {
        key: "up-sell",
        enabled: enableUpSell,
        outcome: "Up",
        side: "SELL",
        price: upBid,
        ratio: upSellRatio,
        momentum: computeMomentum(next.upSell, momentumWindowSec),
        threshold: sellRatioMin,
        minMomentum
      },
      {
        key: "down-buy",
        enabled: enableDownBuy,
        outcome: "Down",
        side: "BUY",
        price: downAsk,
        ratio: downBuyRatio,
        momentum: computeMomentum(next.downBuy, momentumWindowSec),
        threshold: buyRatioMin,
        minMomentum
      },
      {
        key: "down-sell",
        enabled: enableDownSell,
        outcome: "Down",
        side: "SELL",
        price: downBid,
        ratio: downSellRatio,
        momentum: computeMomentum(next.downSell, momentumWindowSec),
        threshold: sellRatioMin,
        minMomentum
      }
    ];

    const outcomeLock = new Set();
    for (const signal of signals) {
      if (!signal.enabled) continue;
      if (!Number.isFinite(signal.price) || !Number.isFinite(signal.ratio)) continue;
      if (signal.side === "BUY" && (signal.price >= MAX_BUY_PRICE || signal.price < MIN_BUY_PRICE)) continue;
      if (signal.side === "SELL" && (positionsRef.current[signal.outcome] ?? 0) <= 0) continue;
      if (signal.side === "BUY" && inLoserBuyClamp && favoredOutcome && signal.outcome !== favoredOutcome) continue;
      if (signal.side === "SELL" && inWinnerHold && favoredOutcome && signal.outcome === favoredOutcome) continue;
      const passesRatio = signal.ratio >= signal.threshold;
      const favored = signal.outcome === "Up"
        ? Number.isFinite(upAsk) && Number.isFinite(downAsk) && upAsk >= downAsk
        : Number.isFinite(upAsk) && Number.isFinite(downAsk) && downAsk >= upAsk;
      const passesWinnerBuy = signal.side === "BUY"
        && Number.isFinite(winnerBuyMinPrice)
        && signal.price >= winnerBuyMinPrice
        && (!winnerBuyRequireFavored || favored);
      if (signal.side === "BUY") {
        if (!passesRatio && !passesWinnerBuy) continue;
      } else if (!passesRatio) {
        continue;
      }
      if (!Number.isFinite(signal.momentum) || signal.momentum < signal.minMomentum) continue;
      if (!shouldTrade(signal.key)) continue;
      if (outcomeLock.has(signal.outcome)) continue;
      outcomeLock.add(signal.outcome);
      lastTradeRef.current[signal.key] = nowSec;
      const reasonParts = [];
      if (passesRatio) reasonParts.push(`ratio>=${fmtNum(signal.threshold, 2)}`);
      if (passesWinnerBuy && !passesRatio) reasonParts.push(`favored price>=${fmtNum(winnerBuyMinPrice, 2)}`);
      reasonParts.push(`mom>=${fmtNum(signal.minMomentum, 4)}`);
      const entry = recordTrade({
        outcome: signal.outcome,
        side: signal.side,
        price: signal.price,
        ratio: signal.ratio,
        momentum: signal.momentum,
        threshold: signal.threshold,
        reason: reasonParts.join(" & ")
      });
      if (!entry || entry.isHedge) continue;
      if (!hedgeEnabled || entry.side !== "BUY") continue;

      const hedgeOutcome = entry.outcome === "Up" ? "Down" : "Up";
      const hedgePrice = hedgeOutcome === "Up" ? upAsk : downAsk;
      const hedgeRatio = hedgeOutcome === "Up" ? upBuyRatio : downBuyRatio;
      const hedgeMomentum = hedgeOutcome === "Up"
        ? computeMomentum(next.upBuy, momentumWindowSec)
        : computeMomentum(next.downBuy, momentumWindowSec);

      if (!Number.isFinite(hedgePrice) || !Number.isFinite(hedgeRatio)) continue;
      if (inLoserBuyClamp && favoredOutcome && hedgeOutcome !== favoredOutcome) continue;
      if (hedgePrice >= MAX_BUY_PRICE || hedgePrice < MIN_BUY_PRICE) continue;
      if (hedgeRatioMax < hedgeRatioMin) continue;
      if (hedgeRatio < hedgeRatioMin || hedgeRatio > hedgeRatioMax) continue;
      if (!Number.isFinite(hedgeSizeMult) || hedgeSizeMult <= 0) continue;

      recordTrade({
        outcome: hedgeOutcome,
        side: "BUY",
        price: hedgePrice,
        ratio: hedgeRatio,
        momentum: hedgeMomentum,
        threshold: `${fmtNum(hedgeRatioMin, 2)}-${fmtNum(hedgeRatioMax, 2)}`,
        reason: `hedge ${entry.outcome} BUY · ratio in [${fmtNum(hedgeRatioMin, 2)}, ${fmtNum(hedgeRatioMax, 2)}]`,
        isHedge: true,
        hedgeOf: entry.id,
        sizeOverride: Math.min(maxSize, entry.size * hedgeSizeMult)
      });
    }
  }, [
    upAsk,
    upBid,
    downAsk,
    downBid,
    upBuyRatio,
    upSellRatio,
    downBuyRatio,
    downSellRatio,
    simEnabled,
    buyRatioMin,
    sellRatioMin,
    minMomentum,
    momentumWindowSec,
    baseSize,
    maxSize,
    sizeScale,
    cooldownSec,
    hedgeEnabled,
    hedgeRatioMin,
    hedgeRatioMax,
    hedgeSizeMult,
    winnerBuyMinPrice,
    winnerBuyRequireFavored,
    endClampLoserBuySec,
    endClampWinnerSellSec,
    enableUpBuy,
    enableUpSell,
    enableDownBuy,
    enableDownSell,
    activeAsset
  ]);

  const markers = useMemo(() => {
    const map = { upBuy: [], upSell: [], downBuy: [], downSell: [] };
    for (const trade of trades) {
      const marker = {
        time: trade.time,
        position: trade.side === "BUY" ? "belowBar" : "aboveBar",
        color: trade.outcome === "Up"
          ? (trade.side === "BUY" ? "#45ffb2" : "#59d7ff")
          : (trade.side === "BUY" ? "#ffcc66" : "#ff5c7a"),
        shape: trade.side === "BUY" ? "arrowUp" : "arrowDown",
        text: `${trade.isHedge ? "H " : ""}${trade.outcome} ${trade.side} ${fmtNum(trade.size, 0)}`
      };
      if (trade.outcome === "Up" && trade.side === "BUY") map.upBuy.push(marker);
      if (trade.outcome === "Up" && trade.side === "SELL") map.upSell.push(marker);
      if (trade.outcome === "Down" && trade.side === "BUY") map.downBuy.push(marker);
      if (trade.outcome === "Down" && trade.side === "SELL") map.downSell.push(marker);
    }
    return map;
  }, [trades]);

  const resetSim = () => {
    setTrades([]);
    setRatioSeries({ upBuy: [], upSell: [], downBuy: [], downSell: [] });
    positionsRef.current = { Up: 0, Down: 0 };
    setPositions({ Up: 0, Down: 0 });
    lastTradeRef.current = {};
  };

  const calcSizePreview = (ratio, threshold, side, outcome) => {
    if (!Number.isFinite(ratio) || !Number.isFinite(threshold) || threshold <= 0) return 0;
    const multiplier = Math.max(1, ratio / threshold);
    const sized = Math.min(maxSize, baseSize * Math.pow(multiplier, sizeScale));
    if (side === "SELL") {
      const available = positions[outcome] ?? 0;
      return Math.max(0, Math.min(sized, available));
    }
    return sized;
  };

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="h1">Trend Sizing Simulator</div>
          <div className="sub">Forward test payout-ratio gating with live CLOB BBO. Simulation only.</div>
        </div>
        <div className="pills">
          <span className="pill">Market: <span className="mono">{activeMarketSlug ?? "-"}</span></span>
          <span className="pill">Meta: <span className="mono">{metaLoading ? "loading" : metaErr ? "error" : "live"}</span></span>
          <span className="pill">Sim: <span className="mono">{simEnabled ? "running" : "paused"}</span></span>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab.asset}
            className={`tab ${activeAsset === tab.asset ? "tabActive" : ""}`}
            onClick={() => setActiveAsset(tab.asset)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {metaErr ? <div className="error">{metaErr}</div> : null}

      <div className="grid">
        <section className="card">
          <div className="cardTop">
            <div className="cardTitle">Payout Ratio Chart</div>
            <div className="ratioLegend">
              <span className="ratioTag upBuy">Up Buy</span>
              <span className="ratioTag upSell">Up Sell</span>
              <span className="ratioTag downBuy">Down Buy</span>
              <span className="ratioTag downSell">Down Sell</span>
            </div>
          </div>
          <div className="cardBody">
            <div className="chartShell">
              <RatioChart series={ratioSeries} markers={markers} />
              {ratioSeries.upBuy.length === 0 ? (
                <div className="chartEmpty">Waiting for CLOB best bid/ask…</div>
              ) : null}
            </div>
            <div className="chartBelowGrid">
              <div className="tradeHistory">
                <div className="tradeHistoryHeader">
                  <div className="cardTitle">Live Ratios</div>
                  <div className="tradeHistoryMeta mono">{fmtNum(ratioSeries.upBuy.length, 0)} pts</div>
                </div>
                <div className="tradeHistoryList">
                  <div className="tradeHistoryItem">
                    <div className="tradeHistoryRow">
                      <span>Up Ask/Bid</span>
                      <span className="mono">{fmtUsd(upAsk, 2)} / {fmtUsd(upBid, 2)}</span>
                    </div>
                    <div className="tradeHistoryRow">
                      <span>Up Buy/Sell Ratio</span>
                      <span className="mono">{fmtRatio(upBuyRatio, 2)} / {fmtRatio(upSellRatio, 2)}</span>
                    </div>
                    <div className="tradeHistoryRow">
                      <span>Down Ask/Bid</span>
                      <span className="mono">{fmtUsd(downAsk, 2)} / {fmtUsd(downBid, 2)}</span>
                    </div>
                    <div className="tradeHistoryRow">
                      <span>Down Buy/Sell Ratio</span>
                      <span className="mono">{fmtRatio(downBuyRatio, 2)} / {fmtRatio(downSellRatio, 2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="tradeConsole">
                <div className="tradeConsoleHeader">
                  <div className="cardTitle">State & Momentum</div>
                  <div className="tradeHistoryMeta mono">cooldown {cooldownSec}s</div>
                </div>
                <div className="kv">
                  <div className="k">Up Buy Momentum</div>
                  <div className="v mono">{fmtNum(upBuyMomentum, 6)}</div>
                </div>
                <div className="kv">
                  <div className="k">Up Sell Momentum</div>
                  <div className="v mono">{fmtNum(upSellMomentum, 6)}</div>
                </div>
                <div className="kv">
                  <div className="k">Down Buy Momentum</div>
                  <div className="v mono">{fmtNum(downBuyMomentum, 6)}</div>
                </div>
                <div className="kv">
                  <div className="k">Down Sell Momentum</div>
                  <div className="v mono">{fmtNum(downSellMomentum, 6)}</div>
                </div>
                <div className="kv">
                  <div className="k">Time Left</div>
                  <div className="v mono">{fmtTimeLeftSec(timeLeftSec)}</div>
                </div>
                <div className="kv">
                  <div className="k">Positions</div>
                  <div className="v posSplit mono">
                    <span>Up {fmtNum(positions.Up, 2)}</span>
                    <span>Down {fmtNum(positions.Down, 2)}</span>
                  </div>
                </div>
                <div className="kv">
                  <div className="k">Trades</div>
                  <div className="v mono">{fmtNum(trades.length, 0)}</div>
                </div>
                <div className="tradeHeaderActions" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => setSimEnabled((v) => !v)}>
                    {simEnabled ? "Pause Simulation" : "Resume Simulation"}
                  </button>
                  <button className="btn" onClick={resetSim}>Clear</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="cardTop">
            <div className="cardTitle">Strategy Controls</div>
          </div>
          <div className="cardBody">
            <div className="tradeControls">
              <div className="tradeControl">
                <div className="tradeControlLabel">Buy Ratio Min</div>
                <input
                  className="tradeInput"
                  type="number"
                  step="0.1"
                  value={buyRatioMin}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setBuyRatioMin(Number.isFinite(next) ? next : 0);
                  }}
                />
                <div className="tradeControlHint">Buy if ratio ≥ threshold</div>
              </div>
              <div className="tradeControl">
                <div className="tradeControlLabel">Sell Ratio Min</div>
                <input
                  className="tradeInput"
                  type="number"
                  step="0.1"
                  value={sellRatioMin}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSellRatioMin(Number.isFinite(next) ? next : 0);
                  }}
                />
                <div className="tradeControlHint">Sell if ratio ≥ threshold</div>
              </div>
              <div className="tradeControl">
                <div className="tradeControlLabel">Momentum Window (s)</div>
                <input
                  className="tradeInput"
                  type="number"
                  min="1"
                  step="1"
                  value={momentumWindowSec}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setMomentumWindowSec(Number.isFinite(next) && next > 0 ? next : 1);
                  }}
                />
              </div>
              <div className="tradeControl">
                <div className="tradeControlLabel">Min Momentum / s</div>
                <input
                  className="tradeInput"
                  type="number"
                  step="0.0001"
                  value={minMomentum}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setMinMomentum(Number.isFinite(next) ? next : 0);
                  }}
                />
              </div>
              <div className="tradeControl">
                <div className="tradeControlLabel">Base Size</div>
                <input
                  className="tradeInput"
                  type="number"
                  step="1"
                  value={baseSize}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setBaseSize(Number.isFinite(next) ? next : 0);
                  }}
                />
              </div>
              <div className="tradeControl">
                <div className="tradeControlLabel">Max Size</div>
                <input
                  className="tradeInput"
                  type="number"
                  step="1"
                  value={maxSize}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setMaxSize(Number.isFinite(next) ? next : 0);
                  }}
                />
              </div>
              <div className="tradeControl">
                <div className="tradeControlLabel">Size Scale</div>
                <input
                  className="tradeInput"
                  type="number"
                  step="0.1"
                  value={sizeScale}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSizeScale(Number.isFinite(next) ? next : 1);
                  }}
                />
              </div>
              <div className="tradeControl">
                <div className="tradeControlLabel">Cooldown (s)</div>
                <input
                  className="tradeInput"
                  type="number"
                  min="0"
                  step="1"
                  value={cooldownSec}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setCooldownSec(Number.isFinite(next) && next >= 0 ? next : 0);
                  }}
                />
              </div>
            </div>

            <div className="toggleGrid" style={{ marginTop: 14 }}>
              <label className="toggleRow">
                <input type="checkbox" checked={enableUpBuy} onChange={(e) => setEnableUpBuy(e.target.checked)} />
                <span>Enable Up BUY</span>
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={enableUpSell} onChange={(e) => setEnableUpSell(e.target.checked)} />
                <span>Enable Up SELL</span>
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={enableDownBuy} onChange={(e) => setEnableDownBuy(e.target.checked)} />
                <span>Enable Down BUY</span>
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={enableDownSell} onChange={(e) => setEnableDownSell(e.target.checked)} />
                <span>Enable Down SELL</span>
              </label>
            </div>

            <div className="tradeTableWrap">
              <div className="cardTitle" style={{ marginBottom: 8 }}>Conditional Hedge</div>
              <div className="toggleGrid">
                <label className="toggleRow">
                  <input type="checkbox" checked={hedgeEnabled} onChange={(e) => setHedgeEnabled(e.target.checked)} />
                  <span>Enable Opposite BUY Hedge</span>
                </label>
                <div className="tradeControlHint">Hedge only when opposite buy ratio is within range.</div>
              </div>
              <div className="tradeControls" style={{ marginTop: 10 }}>
                <div className="tradeControl">
                  <div className="tradeControlLabel">Hedge Ratio Min</div>
                  <input
                    className="tradeInput"
                    type="number"
                    step="0.1"
                    value={hedgeRatioMin}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setHedgeRatioMin(Number.isFinite(next) ? next : 0);
                    }}
                  />
                </div>
                <div className="tradeControl">
                  <div className="tradeControlLabel">Hedge Ratio Max</div>
                  <input
                    className="tradeInput"
                    type="number"
                    step="0.1"
                    value={hedgeRatioMax}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setHedgeRatioMax(Number.isFinite(next) ? next : 0);
                    }}
                  />
                </div>
                <div className="tradeControl">
                  <div className="tradeControlLabel">Hedge Size Mult</div>
                  <input
                    className="tradeInput"
                    type="number"
                    step="0.1"
                    value={hedgeSizeMult}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setHedgeSizeMult(Number.isFinite(next) ? next : 1);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="tradeTableWrap">
              <div className="cardTitle" style={{ marginBottom: 8 }}>Winner Buy Gate</div>
              <div className="tradeControls">
                <div className="tradeControl">
                  <div className="tradeControlLabel">Winner Buy Min Price</div>
                  <input
                    className="tradeInput"
                    type="number"
                    step="0.01"
                    value={winnerBuyMinPrice}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setWinnerBuyMinPrice(Number.isFinite(next) ? next : 0);
                    }}
                  />
                </div>
              </div>
              <div className="toggleGrid" style={{ marginTop: 8 }}>
                <label className="toggleRow">
                  <input
                    type="checkbox"
                    checked={winnerBuyRequireFavored}
                    onChange={(e) => setWinnerBuyRequireFavored(e.target.checked)}
                  />
                  <span>Require Favored Side</span>
                </label>
              </div>
              <div className="tradeControlHint" style={{ marginTop: 6 }}>
                Allows BUY on the higher-priced side even when payout ratio is low.
              </div>
            </div>

            <div className="tradeTableWrap">
              <div className="cardTitle" style={{ marginBottom: 8 }}>End Window Rules</div>
              <div className="tradeControls">
                <div className="tradeControl">
                  <div className="tradeControlLabel">Stop Loser Buys (s)</div>
                  <input
                    className="tradeInput"
                    type="number"
                    min="0"
                    step="1"
                    value={endClampLoserBuySec}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setEndClampLoserBuySec(Number.isFinite(next) && next >= 0 ? next : 0);
                    }}
                  />
                </div>
                <div className="tradeControl">
                  <div className="tradeControlLabel">Hold Winner Sells (s)</div>
                  <input
                    className="tradeInput"
                    type="number"
                    min="0"
                    step="1"
                    value={endClampWinnerSellSec}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setEndClampWinnerSellSec(Number.isFinite(next) && next >= 0 ? next : 0);
                    }}
                  />
                </div>
              </div>
              <div className="tradeControlHint" style={{ marginTop: 6 }}>
                Near expiry, avoid adding to the losing side and avoid selling the favored side.
              </div>
            </div>

            <div className="tradeTableWrap">
              <div className="cardTitle" style={{ marginBottom: 8 }}>Derived Sizing</div>
              <div className="kv">
                <div className="k">Up Buy Size</div>
                <div className="v mono">{fmtNum(calcSizePreview(upBuyRatio, buyRatioMin, "BUY", "Up"), 2)}</div>
              </div>
              <div className="kv">
                <div className="k">Up Sell Size</div>
                <div className="v mono">{fmtNum(calcSizePreview(upSellRatio, sellRatioMin, "SELL", "Up"), 2)}</div>
              </div>
              <div className="kv">
                <div className="k">Down Buy Size</div>
                <div className="v mono">{fmtNum(calcSizePreview(downBuyRatio, buyRatioMin, "BUY", "Down"), 2)}</div>
              </div>
              <div className="kv">
                <div className="k">Down Sell Size</div>
                <div className="v mono">{fmtNum(calcSizePreview(downSellRatio, sellRatioMin, "SELL", "Down"), 2)}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="cardTop">
          <div className="cardTitle">Simulated Buys & Sells</div>
          <div className="tradeHistoryMeta mono">{trades.length} entries</div>
        </div>
        <div className="cardBody">
          {trades.length ? (
            <div className="tradeHistoryList">
              {trades.map((trade) => (
                <div key={trade.id} className="tradeHistoryItem">
                  <div className="tradeHistoryRow">
                    <span className="mono">{new Date(trade.ts).toLocaleTimeString()}</span>
                    <span className="tradeHistoryTag">{trade.outcome.toUpperCase()}</span>
                    <span className="tradeHistoryTag">{trade.side}</span>
                    {trade.isHedge ? <span className="tradeHistoryTag">HEDGE</span> : null}
                  </div>
                  <div className="tradeHistoryRow">
                    <span>{trade.asset.toUpperCase()} · {fmtNum(trade.size, 0)} sh</span>
                    <span>Price {fmtUsd(trade.price, 2)} · Ratio {fmtRatio(trade.ratio, 2)}</span>
                  </div>
                  <div className="tradeHistoryRow">
                    <span>Momentum {fmtNum(trade.momentum, 6)}</span>
                    <span>Pos After {fmtNum(trade.positionAfter, 2)} sh</span>
                  </div>
                  <div className="tradeHistoryRow">{trade.reason}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="tradeHistoryEmpty">No simulated trades yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
