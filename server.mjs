import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5173);

if (process.env.REKTAURANT_STRICT_TLS !== "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const config = {
  publicAppUrl: stripTrailingSlash(process.env.REKTAURANT_PUBLIC_URL || (process.env.VERCEL ? "https://rektaurant.vercel.app" : "")),
  mccApiBase: stripTrailingSlash(process.env.MCC_API_BASE || "https://important-bullet-sam-affiliates.trycloudflare.com"),
  allowClientApiOverride:
    process.env.REKTAURANT_ALLOW_CLIENT_API_OVERRIDE === "true" ||
    (!process.env.VERCEL && process.env.REKTAURANT_ALLOW_CLIENT_API_OVERRIDE !== "false"),
  hyperliquidInfoUrl: process.env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info",
  redisRestUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_KV_REST_API_URL || process.env.KV_REST_API_URL || "",
  redisRestToken:
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.KV_REST_API_READ_WRITE_TOKEN ||
    "",
  notifySecret: process.env.REKTAURANT_NOTIFY_SECRET || "",
  notificationUrlDomains: new Set(
    (process.env.REKTAURANT_NOTIFICATION_URL_DOMAINS || "farcaster.xyz,warpcast.com")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
  ),
  appName: "Rektaurant",
  tipRecipientName: process.env.REKTAURANT_TIP_ENS || "pappardelle.eth",
  tipRecipientAddress: process.env.REKTAURANT_TIP_ADDRESS || "0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134",
  tipToken: {
    symbol: "ETH",
    chain: "Base",
    caip19: "eip155:8453/slip44:60",
    decimals: 18,
    native: true,
  },
  monthlyPass: {
    recipientAddress: process.env.REKTAURANT_DISH_PASS_ADDRESS || "0xce749cde53b8e6791f300555d9ee8b1df9b21f65",
    token: {
      symbol: "pappardelle",
      chain: "Base",
      address: "0x41859a1048fb4f8d668861b1249504bf52e6d3bd",
      caip19: "eip155:8453/erc20:0x41859a1048fb4f8d668861b1249504bf52e6d3bd",
      decimals: 18,
    },
    amountLabel: "10,000,000 pappardelle token",
    amount: "10000000000000000000000000",
    sessionSeconds: 30 * 24 * 60 * 60,
    zoraUrl: "https://zora.co/@pappardelle/creator-coin",
  },
  miniPayAccess: {
    recipientAddress: process.env.REKTAURANT_MINIPAY_ADDRESS || process.env.REKTAURANT_TIP_ADDRESS || "0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134",
    token: {
      symbol: "USDm",
      chain: "Celo",
      address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
      caip19: "eip155:42220/erc20:0x765DE816845861e75A25fCA122bb6898B8B1282a",
      decimals: 18,
    },
    amountLabel: "1 USDm",
    amount: "1000000000000000000",
    sessionSeconds: 10 * 60,
    chainId: "0xa4ec",
    addCashUrl: "https://minipay.opera.com/add_cash",
  },
  stacksVault: {
    contractId: process.env.REKTAURANT_STACKS_CONTRACT_ID || "",
    contractName: process.env.REKTAURANT_STACKS_CONTRACT_NAME || "rektaurant-vault",
    network: process.env.REKTAURANT_STACKS_NETWORK || "mainnet",
    amount: process.env.REKTAURANT_STACKS_VAULT_AMOUNT_USTX || "100000",
    amountLabel: process.env.REKTAURANT_STACKS_VAULT_AMOUNT_LABEL || "0.1 STX",
    sessionSeconds: 10 * 60,
  },
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

const notificationStorageKey = "rektaurant:notification_tokens";
const memoryNotificationTokens = new Map();

export async function rektaurantHandler(request, response) {
  try {
    const requestUrl = requestOrigin(request);
    const origin = config.publicAppUrl || requestUrl;
    const url = new URL(request.url || "/", requestUrl);

    if (url.pathname === "/api/app") {
      await serveStatic(response, "/", origin);
      return;
    }

    if (url.pathname === "/api/menu") {
      await handleMenu(request, response, url);
      return;
    }

    if (url.pathname === "/api/config") {
      await jsonResponse(response, publicConfig());
      return;
    }

    if (url.pathname === "/api/tip-recipient") {
      await jsonResponse(response, tipRecipient());
      return;
    }

    if (url.pathname === "/api/stacks-vault") {
      await jsonResponse(response, stacksVaultConfig());
      return;
    }

    if (url.pathname === "/api/webhook") {
      if (request.method !== "POST") {
        await jsonResponse(response, { ok: false, error: "Method not allowed" }, 405);
        return;
      }
      await jsonResponse(response, await handleWebhook(await readJsonBody(request)));
      return;
    }

    if (url.pathname === "/api/notifications/status") {
      await jsonResponse(response, await notificationStatus());
      return;
    }

    if (url.pathname === "/api/notifications/sync") {
      if (request.method !== "POST") {
        await jsonResponse(response, { ok: false, error: "Method not allowed" }, 405);
        return;
      }
      await jsonResponse(response, await handleNotificationSync(await readJsonBody(request)));
      return;
    }

    if (url.pathname === "/api/notifications/preview") {
      await jsonResponse(response, {
        ok: true,
        notifications: ["open", "closed", "closing", "happy-hour"].map((type) => notificationTemplate(type)),
      });
      return;
    }

    if (url.pathname === "/api/notifications/send") {
      if (request.method !== "POST") {
        await jsonResponse(response, { ok: false, error: "Method not allowed" }, 405);
        return;
      }
      await jsonResponse(response, await handleNotificationSend(request, origin));
      return;
    }

    if (url.pathname === "/api/mcc-health") {
      const apiBase = effectiveMccApiBase(url);
      await jsonResponse(response, {
        ...(config.allowClientApiOverride ? { apiBase } : {}),
        health: await upstreamHealth(apiBase),
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    if (url.pathname === "/api/health") {
      await jsonResponse(response, {
        ok: true,
        app: config.appName,
        upstream: await upstreamHealth(),
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    if (url.pathname === "/robots.txt") {
      await textResponse(response, robotsTxt(origin));
      return;
    }

    if (url.pathname === "/sitemap.xml") {
      await xmlResponse(response, await sitemapXml(origin));
      return;
    }

    if (url.pathname === "/llms.txt") {
      await textResponse(response, llmsTxt(origin));
      return;
    }

    if (url.pathname === "/.well-known/farcaster.json" || url.pathname === "/api/manifest") {
      await jsonResponse(response, farcasterManifest(origin));
      return;
    }

    await serveStatic(response, url.pathname, origin);
  } catch (error) {
    console.error(error);
    await jsonResponse(response, { error: "Rektaurant service error", detail: String(error?.message || error) }, 500);
  }
}

if (isDirectRun()) {
  createServer(rektaurantHandler).listen(port, () => {
    console.log(`Rektaurant is open at http://localhost:${port}`);
  });
}

export default rektaurantHandler;

async function handleMenu(_request, response, url) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 30, 12);
  const minSetupScore = clampInt(url.searchParams.get("minSetupScore"), 0, 100, 24);
  const operationMode = modeParam(url.searchParams.get("operationMode") || url.searchParams.get("mode"));
  const side = sideParam(url.searchParams.get("side"));
  const apiBase = effectiveMccApiBase(url);

  try {
    const [signalsFeed, health] = await Promise.all([
      fetchMccSignals({ limit, minSetupScore, operationMode, side, apiBase }),
      upstreamHealth(apiBase),
    ]);

    const dishes = signalsFeed.signals.map((signal, index) => signalToDish(signal, index));
    if (dishes.length > 0) {
      await jsonResponse(response, {
        source: "mcc",
        model: signalsFeed.model,
        generatedAt: signalsFeed.generatedAt,
        operationMode: signalsFeed.operationMode,
        ...(config.allowClientApiOverride ? { apiBase } : {}),
        health,
        summary: menuSummary(dishes, signalsFeed.safety),
        dishes,
        safety: signalsFeed.safety || [],
      });
      return;
    }

    const fallback = await fetchHyperliquidFallback({ limit, side });
    await jsonResponse(response, fallback);
  } catch (error) {
    const fallback = await fetchHyperliquidFallback({ limit, side, upstreamError: String(error?.message || error) });
    await jsonResponse(response, fallback);
  }
}

async function fetchMccSignals({ limit, minSetupScore, operationMode, side, apiBase }) {
  const endpoint = new URL(`${apiBase}/api/v1/bot/hyperliquid/signals`);
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("minSetupScore", String(minSetupScore));
  endpoint.searchParams.set("operationMode", operationMode);
  endpoint.searchParams.set("includeWatch", "true");
  if (side) endpoint.searchParams.set("side", side);

  const response = await fetchWithTimeout(endpoint, { headers: { accept: "application/json" } }, 25000);
  if (!response.ok) throw new Error(`MCC ${response.status} ${response.statusText}`);

  const payload = await response.json();
  if (!Array.isArray(payload.signals)) throw new Error("MCC response did not include signals");
  return payload;
}

async function fetchHyperliquidFallback({ limit, side, upstreamError }) {
  const response = await fetchWithTimeout(
    config.hyperliquidInfoUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    },
    25000,
  );
  if (!response.ok) throw new Error(`Hyperliquid ${response.status} ${response.statusText}`);

  const [meta, contexts] = await response.json();
  const universe = Array.isArray(meta?.universe) ? meta.universe : [];
  const rows = universe
    .map((asset, index) => ({ asset, context: contexts?.[index] }))
    .filter(({ asset, context }) => asset?.name && !asset.isDelisted && Number(context?.openInterest) > 0 && Number(context?.dayNtlVlm) > 0)
    .map(({ asset, context }, index) => fallbackDish(asset, context, index))
    .filter((dish) => !side || dish.side === side)
    .sort((a, b) => b.scores.setup - a.scores.setup || b.volumeUsd24h - a.volumeUsd24h)
    .slice(0, limit);

  return {
    source: "hyperliquid-direct",
    model: "rektaurant-fallback-v1",
    generatedAt: new Date().toISOString(),
    operationMode: "market-read",
    upstreamError,
    summary: menuSummary(rows, [
      "Fallback mode uses public Hyperliquid market context only.",
      "Signals are a themed read-only radar, not execution approval.",
    ]),
    dishes: rows,
    safety: [
      "Rektaurant never sends orders, signatures or approvals.",
      "Fallback mode is heuristic and should be treated as market research only.",
    ],
  };
}

async function upstreamHealth(apiBase = config.mccApiBase) {
  try {
    const response = await fetchWithTimeout(`${apiBase}/api/health`, { headers: { accept: "application/json" } }, 7000);
    if (!response.ok) return { ok: false, status: response.status };
    const payload = await response.json();
    return {
      ok: Boolean(payload.ok),
      marketProvider: payload.marketProvider,
      latestSnapshotAt: payload.localDatabase?.latestSnapshotAt,
      stale: payload.localDatabase?.stale,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function signalToDish(signal, index) {
  const entry = numberOrNull(signal.entryTriggerUsd ?? signal.bestReferenceEntryUsd);
  const target = numberOrNull(signal.targetUsd);
  const invalidation = numberOrNull(signal.invalidationUsd);
  const confidence = round(numberOrNull(signal.confidence) ?? 0, 1);
  const setup = round(numberOrNull(signal.setupScore) ?? 0, 0);
  const entryScore = round(numberOrNull(signal.entryScore) ?? 0, 0);
  const timing = round(numberOrNull(signal.timingScore) ?? 0, 0);
  const alpha = round(numberOrNull(signal.alphaScore) ?? 0, 0);

  return {
    id: signal.id || `mcc-${index}`,
    coin: signal.symbol,
    side: normalizeSignalSide(signal.side),
    dishName: dishName(signal.symbol, normalizeSignalSide(signal.side), index),
    course: courseFor(signal.recommendation, signal.lifecycleState),
    chefCall: chefCall(signal.recommendation, signal.quantAction),
    recommendation: signal.recommendation,
    decision: signal.decision,
    lifecycle: signal.lifecycleState,
    confidence,
    expectedValuePct: numberOrNull(signal.expectedValuePct),
    entryUsd: entry,
    targetUsd: target,
    invalidationUsd: invalidation,
    riskRewardRatio: numberOrNull(signal.riskRewardRatio),
    suggestedSizingPct: numberOrNull(signal.suggestedSizingPct),
    waitMinutes: numberOrNull(signal.expectedWaitMinutes),
    allowedForPaper: Boolean(signal.allowedForPaper),
    allowedForExecutionLayer: Boolean(signal.allowedForExecutionLayer),
    scores: { setup, entry: entryScore, timing, alpha },
    volumeUsd24h: 0,
    plating: platingFor(signal.recommendation, normalizeSignalSide(signal.side)),
    reasons: Array.isArray(signal.why) ? signal.why.slice(0, 4) : [],
    warnings: Array.isArray(signal.warnings) ? signal.warnings.slice(0, 4) : [],
  };
}

function fallbackDish(asset, context, index) {
  const mark = numberOrNull(context.markPx ?? context.midPx ?? context.oraclePx) ?? 0;
  const previous = numberOrNull(context.prevDayPx) ?? mark;
  const changePct = previous > 0 ? ((mark - previous) / previous) * 100 : 0;
  const funding8hPct = (numberOrNull(context.funding) ?? 0) * 8 * 100;
  const premiumBps = (numberOrNull(context.premium) ?? 0) * 10000;
  const volumeUsd24h = numberOrNull(context.dayNtlVlm) ?? 0;
  const openInterest = numberOrNull(context.openInterest) ?? 0;
  const computedSide = changePct >= 0 && funding8hPct < 0.08 ? "long" : "short";
  const move = Math.max(Math.abs(changePct), 0.35);
  const setup = clamp(Math.round(Math.abs(changePct) * 7 + Math.log10(Math.max(volumeUsd24h, 1)) * 7 + Math.min(Math.abs(premiumBps), 25) * 0.5), 18, 88);
  const targetMovePct = clamp(move * 0.45, 0.45, 3.2);
  const stopMovePct = clamp(move * 0.34, 0.35, 2.4);

  return {
    id: `hl-${asset.name}-${index}`,
    coin: asset.name,
    side: computedSide,
    dishName: dishName(asset.name, computedSide, index),
    course: computedSide === "long" ? "Momentum mains" : "Contrarian specials",
    chefCall: computedSide === "long" ? "Simmer long bias" : "Plate short bias",
    recommendation: "MARKET_READ",
    decision: "FALLBACK_RADAR",
    lifecycle: "TRACKING",
    confidence: clamp(Math.round(setup * 0.72), 20, 72),
    expectedValuePct: round(computedSide === "long" ? Math.max(changePct * 0.14, -0.8) : Math.max(-changePct * 0.14, -0.8), 2),
    entryUsd: mark,
    targetUsd: round(mark * (computedSide === "long" ? 1 + targetMovePct / 100 : 1 - targetMovePct / 100), priceDecimals(mark)),
    invalidationUsd: round(mark * (computedSide === "long" ? 1 - stopMovePct / 100 : 1 + stopMovePct / 100), priceDecimals(mark)),
    riskRewardRatio: round(targetMovePct / stopMovePct, 2),
    suggestedSizingPct: 0,
    waitMinutes: null,
    allowedForPaper: false,
    allowedForExecutionLayer: false,
    scores: {
      setup,
      entry: clamp(Math.round(42 + Math.abs(premiumBps) * 0.4), 20, 78),
      timing: clamp(Math.round(44 + Math.abs(changePct) * 5), 20, 76),
      alpha: clamp(Math.round(38 + Math.abs(changePct) * 4 + Math.log10(Math.max(openInterest, 1)) * 3), 20, 82),
    },
    volumeUsd24h,
    openInterest,
    marketContext: {
      changePct24h: round(changePct, 2),
      funding8hPct: round(funding8hPct, 4),
      premiumBps: round(premiumBps, 2),
    },
    plating: computedSide === "long" ? "Fresh mark, volume glaze, funding garnish" : "Oracle reduction, premium crust, OI jus",
    reasons: [
      `24h move ${round(changePct, 2)}% with ${formatUsd(volumeUsd24h)} notional volume.`,
      `Funding 8h estimate ${round(funding8hPct, 4)}% and premium ${round(premiumBps, 2)} bps.`,
      "Generated from public Hyperliquid market context because MCC signals were empty or unavailable.",
    ],
    warnings: [
      "Fallback dishes are heuristic market reads, not MCC-trained bot signals.",
      "Reprice on Hyperliquid and check spread, depth and liquidation risk before acting.",
    ],
  };
}

function menuSummary(dishes, safety) {
  const longs = dishes.filter((dish) => dish.side === "long").length;
  const shorts = dishes.filter((dish) => dish.side === "short").length;
  const top = dishes[0];
  return {
    title: top ? `${top.coin} is at the pass` : "Kitchen is waiting for a cleaner setup",
    longCount: longs,
    shortCount: shorts,
    averageSetup: dishes.length ? round(dishes.reduce((sum, dish) => sum + dish.scores.setup, 0) / dishes.length, 1) : 0,
    safety: safety?.[0] || "Read-only signal menu. No execution.",
  };
}

function farcasterManifest(origin) {
  const accountAssociation = parseAccountAssociation();
  return {
    ...(accountAssociation ? { accountAssociation } : {}),
    miniapp: {
      version: "1",
      name: "Rektaurant",
      homeUrl: `${origin}/`,
      iconUrl: `${origin}/assets/icon-1024.png`,
      splashImageUrl: `${origin}/assets/splash-200.png`,
      splashBackgroundColor: "#171214",
      webhookUrl: `${origin}/api/webhook`,
      subtitle: "Base signal menu",
      description: "Base and Farcaster Mini App serving restaurant themed Hyperliquid long and short signal dishes for read only market research.",
      primaryCategory: "finance",
      tags: ["base", "hyperliquid", "signals", "crypto", "farcaster"],
      heroImageUrl: `${origin}/assets/hero-1200x630.png`,
      ogTitle: "Rektaurant | Base Mini App for Hyperliquid Signals",
      ogDescription: "A restaurant themed crypto signal menu for Base, Farcaster, and Hyperliquid hunters.",
      ogImageUrl: `${origin}/assets/hero-1200x630.png`,
      requiredCapabilities: ["actions.ready", "actions.composeCast", "actions.addMiniApp", "actions.sendToken"],
      noindex: process.env.REKTAURANT_NOINDEX === "true",
    },
  };
}

function robotsTxt(origin) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /_vercel/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

async function sitemapXml(origin) {
  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    const indexStat = await stat(path.join(publicDir, "index.html"));
    lastmod = indexStat.mtime.toISOString().slice(0, 10);
  } catch {
    // Keep the request date if the static file timestamp is unavailable.
  }

  const homeUrl = xmlEscape(`${origin}/`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${homeUrl}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    "    <changefreq>hourly</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    "</urlset>",
    "",
  ].join("\n");
}

function llmsTxt(origin) {
  return [
    "# Rektaurant",
    "",
    "> Base and Farcaster Mini App that serves Hyperliquid long and short crypto signals as a restaurant themed menu.",
    "",
    `Canonical: ${origin}/`,
    "Repository: https://github.com/mikeminer/rektaurant",
    "Creator: pappardelle.eth",
    "Creator profile: https://github.com/mikeminer",
    "Creator coin: https://zora.co/@pappardelle/creator-coin",
    "",
    "Topics: Base, Based ecosystem, Farcaster Mini Apps, Hyperliquid, crypto signals, DeFi, long/short market research, pappardelle.",
    "Positioning: read-only signal discovery for crypto hunters; Rektaurant does not place trades or provide execution approval.",
    "",
  ].join("\n");
}

function tipRecipient() {
  if (!isEvmAddress(config.tipRecipientAddress) || !isEvmAddress(config.monthlyPass.recipientAddress) || !isEvmAddress(config.miniPayAccess.recipientAddress)) {
    return {
      ok: false,
      error: "Invalid payment recipient address",
      recipientName: config.tipRecipientName,
      token: config.tipToken,
    };
  }

  return {
    ok: true,
    recipientName: config.tipRecipientName,
    recipientAddress: config.tipRecipientAddress,
    token: config.tipToken,
    sessionSeconds: 10 * 60,
    suggestedTips: [
      { label: "0.0002 ETH", amount: "200000000000000" },
      { label: "0.0005 ETH", amount: "500000000000000" },
      { label: "0.001 ETH", amount: "1000000000000000" },
    ],
    monthlyPass: config.monthlyPass,
    miniPayAccess: config.miniPayAccess,
    stacksVault: stacksVaultConfig(),
  };
}

function stacksVaultConfig() {
  const network = config.stacksVault.network === "testnet" ? "testnet" : "mainnet";
  const contractId = String(config.stacksVault.contractId || "").trim();
  const enabled = isStacksContractId(contractId);
  return {
    enabled,
    contractId: enabled ? contractId : "",
    contractName: config.stacksVault.contractName,
    network,
    amount: config.stacksVault.amount,
    amountLabel: config.stacksVault.amountLabel,
    sessionSeconds: config.stacksVault.sessionSeconds,
    explorerUrl: enabled ? stacksExplorerContractUrl(contractId, network) : "",
  };
}

async function handleWebhook(payload) {
  const event = parseWebhookEvent(payload);
  if (!event?.event) {
    return { ok: true, ignored: true, reason: "No mini app event found" };
  }

  if ((event.event === "miniapp_added" || event.event === "notifications_enabled") && event.notificationDetails?.token && event.notificationDetails?.url) {
    const record = notificationRecordFromEvent(event);
    if (!record) return { ok: false, event: event.event, error: "Invalid notification details" };
    await saveNotificationToken(record);
    return { ok: true, event: event.event, stored: true, storage: notificationStorageMode() };
  }

  if (event.event === "miniapp_removed" || event.event === "notifications_disabled") {
    const removed = await removeNotificationToken(event);
    return { ok: true, event: event.event, removed, storage: notificationStorageMode() };
  }

  return { ok: true, event: event.event, ignored: true };
}

async function handleNotificationSync(payload) {
  const event = {
    event: "client_context_sync",
    fid: payload?.fid || payload?.user?.fid || null,
    notificationDetails: payload?.notificationDetails || payload?.client?.notificationDetails,
  };
  const record = notificationRecordFromEvent(event);
  if (!record) {
    return { ok: false, stored: false, error: "No valid notification details were provided." };
  }
  await saveNotificationToken(record);
  return {
    ok: true,
    stored: true,
    storage: notificationStorageMode(),
    tokenCount: (await listNotificationTokens()).length,
  };
}

async function handleNotificationSend(request, origin) {
  if (!isAuthorizedNotificationRequest(request)) {
    return { ok: false, error: "Unauthorized notification request." };
  }

  const payload = await readJsonBody(request);
  const template = notificationTemplate(payload.type, payload);
  const records = await listNotificationTokens();
  if (records.length === 0) {
    return { ok: false, error: "No notification tokens stored yet. Users need to save Rektaurant and enable notifications first.", storage: notificationStorageMode() };
  }

  const targetUrl = String(payload.targetUrl || `${origin}/?r=notification&type=${encodeURIComponent(template.type)}`);
  if (new URL(targetUrl).hostname !== new URL(origin).hostname) {
    return { ok: false, error: "Notification targetUrl must stay on rektaurant.vercel.app." };
  }

  const notification = {
    notificationId: String(payload.notificationId || `${template.type}-${Date.now()}`).slice(0, 128),
    title: template.title.slice(0, 32),
    body: template.body.slice(0, 128),
    targetUrl,
  };

  const batches = groupNotificationBatches(records);
  const summary = { successfulTokens: [], invalidTokens: [], rateLimitedTokens: [], failed: [] };

  for (const batch of batches) {
    const result = await sendNotificationBatch(batch.url, {
      ...notification,
      tokens: batch.tokens,
    });
    summary.successfulTokens.push(...(result.successfulTokens || []));
    summary.invalidTokens.push(...(result.invalidTokens || []));
    summary.rateLimitedTokens.push(...(result.rateLimitedTokens || []));
    if (result.error) summary.failed.push({ url: batch.url, error: result.error });
  }

  if (summary.invalidTokens.length > 0) {
    await removeNotificationTokensByToken(summary.invalidTokens);
  }

  return {
    ok: true,
    type: template.type,
    sentTo: records.length,
    storage: notificationStorageMode(),
    ...summary,
  };
}

function parseWebhookEvent(payload) {
  const decodedHeader = decodeJsonPayload(payload?.header);
  const decodedPayload = decodeJsonPayload(payload?.payload);
  const candidates = [payload?.data, payload?.eventData, payload, decodedPayload?.data, decodedPayload?.eventData, decodedPayload].filter(Boolean);
  const eventData = candidates.find((candidate) => typeof candidate.event === "string");
  if (!eventData) return null;
  return {
    ...eventData,
    fid: eventData.fid || eventData.user?.fid || decodedPayload?.fid || decodedHeader?.fid || payload?.fid || null,
  };
}

function decodeJsonPayload(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function notificationRecordId(event) {
  const fid = event.fid ? `fid:${event.fid}` : "anonymous";
  const url = event.notificationDetails?.url || "default";
  const token = event.notificationDetails?.token || "";
  return `${fid}:${Buffer.from(`${url}:${token}`).toString("base64url").slice(0, 24)}`;
}

function notificationRecordFromEvent(event) {
  if (!isValidNotificationDetails(event.notificationDetails)) return null;
  return {
    id: notificationRecordId(event),
    event: event.event,
    fid: event.fid || null,
    token: String(event.notificationDetails.token),
    url: String(event.notificationDetails.url),
    updatedAt: new Date().toISOString(),
  };
}

function isValidNotificationDetails(details) {
  if (!details?.token || !details?.url) return false;
  const token = String(details.token);
  if (token.length < 8 || token.length > 1024) return false;
  try {
    const url = new URL(String(details.url));
    return url.protocol === "https:" && url.toString().length < 2048 && isAllowedNotificationUrl(url);
  } catch {
    return false;
  }
}

function isAllowedNotificationUrl(url) {
  const host = url.hostname.toLowerCase();
  return [...config.notificationUrlDomains].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function saveNotificationToken(record) {
  if (hasRedisStorage()) {
    await redisCommand("HSET", notificationStorageKey, record.id, JSON.stringify(record));
    return;
  }
  memoryNotificationTokens.set(record.id, record);
}

async function removeNotificationToken(event) {
  const records = await listNotificationTokens();
  const matches = records.filter((record) => (event.fid && String(record.fid) === String(event.fid)) || record.token === event.notificationDetails?.token);
  await removeNotificationRecords(matches);
  return matches.length;
}

async function removeNotificationTokensByToken(tokens) {
  const tokenSet = new Set(tokens);
  const records = (await listNotificationTokens()).filter((record) => tokenSet.has(record.token));
  await removeNotificationRecords(records);
}

async function removeNotificationRecords(records) {
  if (records.length === 0) return;
  if (hasRedisStorage()) {
    await Promise.all(records.map((record) => redisCommand("HDEL", notificationStorageKey, record.id)));
    return;
  }
  records.forEach((record) => memoryNotificationTokens.delete(record.id));
}

async function listNotificationTokens() {
  if (hasRedisStorage()) {
    const result = await redisCommand("HGETALL", notificationStorageKey);
    const pairs = Array.isArray(result) ? result : [];
    const records = [];
    for (let index = 0; index < pairs.length; index += 2) {
      try {
        records.push(JSON.parse(pairs[index + 1]));
      } catch {
        // Ignore malformed storage entries.
      }
    }
    return records.filter((record) => record?.token && record?.url);
  }
  return Array.from(memoryNotificationTokens.values());
}

async function notificationStatus() {
  return {
    ok: true,
    storage: notificationStorageMode(),
    configured: hasRedisStorage(),
    tokenCount: (await listNotificationTokens()).length,
  };
}

function notificationTemplate(type, payload = {}) {
  const templates = {
    open: [
      {
        title: "Pass is hot",
        body: "Fresh long and short dishes just hit the Rektaurant menu.",
      },
      {
        title: "Service is open",
        body: "The chef is plating Hyperliquid signals. Come taste the setup.",
      },
      {
        title: "New menu live",
        body: "Hot perp specials are on the pass. Longs, shorts, and risk notes served fresh.",
      },
    ],
    closed: [
      {
        title: "Kitchen lights off",
        body: "Rektaurant is closed. No cold signals, no stale plates. Back soon.",
      },
      {
        title: "Service paused",
        body: "The pass is cooling down. Fresh long and short dishes return when the kitchen reopens.",
      },
      {
        title: "After service",
        body: "Rektaurant is closed for prep. Tips are paused until the next hot menu.",
      },
    ],
    closing: [
      {
        title: "Last call",
        body: "The pass is closing soon. Grab the hot long/short specials before service ends.",
      },
      {
        title: "Final plates",
        body: "Last signals are leaving the kitchen. Check the menu before the lights go off.",
      },
      {
        title: "Almost closed",
        body: "Rektaurant is plating the final setups. One last look before the pass shuts.",
      },
    ],
    "happy-hour": [
      {
        title: "Happy hour is hot",
        body: "Long and short specials are moving fast. The pass is serving fresh signal plates.",
      },
      {
        title: "Chef's happy hour",
        body: "Fresh Hyperliquid setups on the counter. Come pick a hot plate.",
      },
      {
        title: "Signal specials",
        body: "Happy hour menu is live: warm entries, crisp invalidations, fresh risk notes.",
      },
    ],
  };
  const normalizedType = String(type || "").toLowerCase();
  const options = templates[normalizedType] || templates.open;
  const template = options[Math.floor(Math.random() * options.length)];
  return {
    type: templates[normalizedType] ? normalizedType : "open",
    title: payload.title || template.title,
    body: payload.body || template.body,
  };
}

function groupNotificationBatches(records) {
  const byUrl = new Map();
  records.forEach((record) => {
    if (!byUrl.has(record.url)) byUrl.set(record.url, []);
    byUrl.get(record.url).push(record.token);
  });

  const batches = [];
  byUrl.forEach((tokens, url) => {
    for (let index = 0; index < tokens.length; index += 100) {
      batches.push({ url, tokens: tokens.slice(index, index + 100) });
    }
  });
  return batches;
}

async function sendNotificationBatch(url, payload) {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      },
      12000,
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { error: `Notification server ${response.status}`, ...result };
    return result;
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

function isAuthorizedNotificationRequest(request) {
  if (!config.notifySecret) return false;
  const auth = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const header = String(request.headers["x-rektaurant-secret"] || "");
  return auth === config.notifySecret || header === config.notifySecret;
}

function hasRedisStorage() {
  return Boolean(config.redisRestUrl && config.redisRestToken);
}

function notificationStorageMode() {
  return hasRedisStorage() ? "redis" : "memory";
}

function publicConfig() {
  return {
    appName: config.appName,
    allowClientApiOverride: config.allowClientApiOverride,
    mccApiSource: process.env.MCC_API_BASE ? "env" : "default",
    ...(config.allowClientApiOverride ? { mccApiBase: config.mccApiBase } : {}),
  };
}

function effectiveMccApiBase(url) {
  if (!config.allowClientApiOverride) return config.mccApiBase;
  return apiBaseParam(url.searchParams.get("apiBase")) || config.mccApiBase;
}

async function serveStatic(response, pathname, origin) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(publicDir, `.${decodeURIComponent(safePath)}`);
  if (!filePath.startsWith(publicDir)) {
    await textResponse(response, "Forbidden", 403);
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    await textResponse(response, "Not found", 404);
    return;
  }

  if (!fileStat.isFile()) {
    await textResponse(response, "Not found", 404);
    return;
  }

  const ext = path.extname(filePath);
  response.setHeader("content-type", mimeTypes.get(ext) || "application/octet-stream");
  response.setHeader("cache-control", [".html", ".css", ".js"].includes(ext) ? "no-store" : "public, max-age=3600");
  let body = await readFile(filePath);
  if (ext === ".html") {
    body = Buffer.from(body.toString("utf8").replaceAll("__APP_URL__", origin));
  }
  response.end(body);
}

async function fetchWithTimeout(input, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function redisCommand(command, ...args) {
  if (!hasRedisStorage()) throw new Error("Redis storage is not configured");
  const endpoint = [config.redisRestUrl.replace(/\/+$/, ""), command, ...args].map((part, index) => (index === 0 ? part : encodeURIComponent(String(part)))).join("/");
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.redisRestToken}`, accept: "application/json" },
    },
    12000,
  );
  if (!response.ok) throw new Error(`Redis ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32768) throw new Error("Request body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

async function jsonResponse(response, payload, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function textResponse(response, text, status = 200) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function xmlResponse(response, xml, status = 200) {
  response.writeHead(status, {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, max-age=3600",
  });
  response.end(xml);
}

function requestOrigin(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function parseAccountAssociation() {
  const raw = process.env.REKTAURANT_ACCOUNT_ASSOCIATION;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("Ignoring invalid REKTAURANT_ACCOUNT_ASSOCIATION JSON");
    return null;
  }
}

function sideParam(value) {
  const side = value?.trim().toLowerCase();
  return side === "long" || side === "short" ? side : "";
}

function apiBaseParam(value) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return stripTrailingSlash(url.toString());
  } catch {
    return "";
  }
}

function normalizeSignalSide(value) {
  return String(value || "").toLowerCase().includes("short") ? "short" : "long";
}

function modeParam(value) {
  const mode = value?.trim().toLowerCase();
  return mode === "strict" || mode === "balanced" || mode === "opportunistic" ? mode : "opportunistic";
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function isStacksContractId(value) {
  return /^S[PT][A-Z0-9]{38,41}\.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,127}$/.test(String(value || ""));
}

function stacksExplorerContractUrl(contractId, network) {
  const url = new URL(`/txid/${contractId}`, "https://explorer.hiro.so");
  url.searchParams.set("chain", network === "testnet" ? "testnet" : "mainnet");
  return url.toString();
}

function priceDecimals(price) {
  if (price >= 1000) return 1;
  if (price >= 1) return 4;
  return 6;
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1_000_000_000) return `$${round(value / 1_000_000_000, 2)}B`;
  if (value >= 1_000_000) return `$${round(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${round(value / 1_000, 1)}K`;
  return `$${round(value, 0)}`;
}

function dishName(symbol, side, index) {
  const roots = {
    BTC: "Prime Bitcoin Steak",
    ETH: "Gwei Butter Gnocchi",
    SOL: "Solana Citrus Crudo",
    HYPE: "Hyperliquid Tartare",
    PNUT: "Peanut Pepper Rib",
    RUNE: "Rune Charcoal Skewer",
    DOGE: "Doge Umami Slider",
    XRP: "Ripple Saffron Risotto",
    SUI: "Sui Sea Salt Noodles",
    AVAX: "Avalanche Chili Cutlet",
    LINK: "Chainlink Herb Roast",
    WIF: "WIF Firecracker Taco",
  };
  const longFinishes = ["with green-candle jus", "on momentum glaze", "over breakout broth", "with alpha salsa"];
  const shortFinishes = ["with rejection reduction", "under bear-pepper crust", "over downside demi", "with fade confit"];
  const root = roots[String(symbol).toUpperCase()] || `${symbol} Market Plate`;
  const finishes = side === "long" ? longFinishes : shortFinishes;
  return `${root} ${finishes[index % finishes.length]}`;
}

function courseFor(recommendation, lifecycle) {
  if (recommendation === "ENTER_NOW") return "Chef's fire order";
  if (recommendation === "READY_SOON") return "Ready at the pass";
  if (recommendation === "WAIT_PULLBACK") return "Resting pullback";
  if (recommendation === "WAIT_BREAKOUT") return "Breakout oven";
  if (recommendation === "WATCH_SLOW_BURN") return "Slow-burn tasting";
  if (lifecycle === "RESOLVED") return "After-service review";
  return "Watchlist mise en place";
}

function chefCall(recommendation, quantAction) {
  const action = String(quantAction || "").replaceAll("_", " ").toLowerCase();
  if (recommendation === "ENTER_NOW") return "Serve now";
  if (recommendation === "READY_SOON") return "Plate on confirmation";
  if (recommendation === "WAIT_PULLBACK") return "Wait for the sauce to reduce";
  if (recommendation === "WAIT_BREAKOUT") return "Wait for the lid to lift";
  if (recommendation === "AVOID") return "Send back to prep";
  return action ? `Chef says: ${action}` : "Keep under the heat lamp";
}

function platingFor(recommendation, side) {
  if (recommendation === "ENTER_NOW") return side === "long" ? "Bright herbs, tight stop, fast service" : "Charred edge, tight invalidation, fast service";
  if (recommendation === "READY_SOON") return "Nearly plated, waiting on final confirmation";
  if (recommendation === "WATCH_SLOW_BURN") return "Low flame setup with delayed confirmation risk";
  if (recommendation === "WAIT_PULLBACK") return "Let price revisit the prep station";
  if (recommendation === "WAIT_BREAKOUT") return "Needs a clean break before service";
  return "Research portion, no execution garnish";
}
