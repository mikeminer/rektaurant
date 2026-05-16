const state = {
  mode: "opportunistic",
  side: "",
  minSetupScore: 24,
  dishes: [],
  selectedId: null,
  sdk: null,
  farcasterContext: null,
  isMiniApp: false,
  tipRecipient: null,
  tipAmount: "1000000",
  sessionExpiresAt: 0,
  sessionTimer: null,
  mccApiBase: "",
  allowClientApiOverride: false,
  mccOnline: false,
  walletProvider: null,
  walletAddress: "",
  walletKind: "",
};

const apiBase = window.location.protocol === "file:" ? "http://localhost:5173" : "";
const tipSessionKey = "rektaurant_tip_session_v1";
const baseChainId = "0x2105";
const baseChainParams = {
  chainId: baseChainId,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

const els = {
  appShell: document.querySelector("#appShell"),
  closedGate: document.querySelector("#closedGate"),
  retryHealthButton: document.querySelector("#retryHealthButton"),
  closedStatus: document.querySelector("#closedStatus"),
  tipGate: document.querySelector("#tipGate"),
  tipButton: document.querySelector("#tipButton"),
  previewUnlockButton: document.querySelector("#previewUnlockButton"),
  tipRecipient: document.querySelector("#tipRecipient"),
  tipStatus: document.querySelector("#tipStatus"),
  gateNotifyButton: document.querySelector("#gateNotifyButton"),
  connectWalletButton: document.querySelector("#connectWalletButton"),
  walletStatus: document.querySelector("#walletStatus"),
  sessionTimer: document.querySelector("#sessionTimer"),
  serviceStatus: document.querySelector("#serviceStatus"),
  refreshButton: document.querySelector("#refreshButton"),
  shareButtons: document.querySelectorAll("[data-share-target]"),
  saveButton: document.querySelector("#saveButton"),
  scoreSlider: document.querySelector("#scoreSlider"),
  scoreValue: document.querySelector("#scoreValue"),
  menuList: document.querySelector("#menuList"),
  dishTemplate: document.querySelector("#dishTemplate"),
  ticket: document.querySelector("#ticket"),
  updatedAt: document.querySelector("#updatedAt"),
  sourceMetric: document.querySelector("#sourceMetric"),
  longMetric: document.querySelector("#longMetric"),
  shortMetric: document.querySelector("#shortMetric"),
  avgMetric: document.querySelector("#avgMetric"),
};

boot();

async function boot() {
  await loadAppConfig();
  bindControls();
  await initFarcaster();
  if (!state.isMiniApp && (window.location.hostname === "localhost" || window.location.protocol === "file:")) {
    els.previewUnlockButton.hidden = false;
  }
  await loadTipRecipient();
  await checkMccAndUpdateGate();
  window.setInterval(() => {
    if (isSessionActive() && state.mccOnline) loadMenu();
  }, 120000);
}

function bindControls() {
  els.retryHealthButton.addEventListener("click", () => checkMccAndUpdateGate({ force: true }));

  els.tipButton.addEventListener("click", leaveTip);
  els.previewUnlockButton.addEventListener("click", () => openSession({ transaction: "local-preview" }));
  document.querySelectorAll("[data-tip-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tipAmount = button.dataset.tipAmount;
      setActive("[data-tip-amount]", button);
    });
  });
  els.connectWalletButton.addEventListener("click", () => connectWallet().catch(() => {}));

  els.refreshButton.addEventListener("click", () => loadMenu({ force: true }));
  els.shareButtons.forEach((button) => {
    button.addEventListener("click", () => shareSpecial(button.dataset.shareTarget));
  });
  els.gateNotifyButton.addEventListener("click", turnOnNotifications);
  els.saveButton.addEventListener("click", turnOnNotifications);

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      setActive("[data-mode]", button);
      loadMenu({ force: true });
    });
  });

  document.querySelectorAll("[data-side]").forEach((button) => {
    button.addEventListener("click", () => {
      state.side = button.dataset.side;
      setActive("[data-side]", button);
      renderMenu();
      renderTicket(selectedDish());
    });
  });

  els.scoreSlider.addEventListener("input", () => {
    state.minSetupScore = Number(els.scoreSlider.value);
    els.scoreValue.textContent = String(state.minSetupScore);
  });

  els.scoreSlider.addEventListener("change", () => loadMenu({ force: true }));
}

async function loadAppConfig() {
  try {
    const response = await fetch(`${apiBase}/api/config`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Config API ${response.status}`);
    const config = await response.json();
    state.allowClientApiOverride = Boolean(config.allowClientApiOverride);
    state.mccApiBase = state.allowClientApiOverride ? normalizeApiBase(config.mccApiBase) : "";
  } catch {
    state.allowClientApiOverride = false;
    state.mccApiBase = "";
  }
}

async function checkMccAndUpdateGate({ force = false } = {}) {
  els.closedStatus.textContent = force ? "Checking the kitchen again..." : "Checking the pass...";
  els.retryHealthButton.disabled = true;

  try {
    const params = new URLSearchParams();
    if (state.allowClientApiOverride && state.mccApiBase) params.set("apiBase", state.mccApiBase);
    const query = params.toString();
    const response = await fetch(`${apiBase}/api/mcc-health${query ? `?${query}` : ""}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Health API ${response.status}`);
    const payload = await response.json();
    state.mccOnline = Boolean(payload.health?.ok);

    if (!state.mccOnline) {
      showClosedGate(payload.health?.error || "The signal kitchen is not responding");
      return;
    }

    els.closedStatus.textContent = "Kitchen is open.";
    updateGate();
  } catch (error) {
    state.mccOnline = false;
    showClosedGate(String(error.message || error));
  } finally {
    els.retryHealthButton.disabled = false;
  }
}

function showClosedGate(reason) {
  document.body.classList.remove("is-locked", "is-unlocked");
  document.body.classList.add("is-closed");
  els.appShell.setAttribute("aria-hidden", "true");
  els.tipGate.setAttribute("aria-hidden", "true");
  els.closedGate.hidden = false;
  els.closedGate.removeAttribute("aria-hidden");
  els.closedStatus.textContent = `Closed: ${reason}. The Rektaurant should reopen in the next few hours.`;
  window.clearInterval(state.sessionTimer);
  state.sessionTimer = null;
  els.sessionTimer.hidden = true;
}

async function initFarcaster() {
  try {
    const { sdk } = await import("https://esm.sh/@farcaster/miniapp-sdk");
    state.sdk = sdk;
    state.isMiniApp = await sdk.isInMiniApp();
    if (!state.isMiniApp) {
      els.serviceStatus.textContent = "Browser preview";
      return;
    }
    state.farcasterContext = await sdk.context;
    bindFarcasterEvents();
    await syncNotificationStateFromContext({ silent: true });
    await sdk.actions.ready();
    const username = state.farcasterContext?.user?.username;
    els.serviceStatus.textContent = username ? `Table for @${username}` : "Farcaster table ready";
  } catch {
    els.serviceStatus.textContent = "Browser preview";
    if (window.location.hostname === "localhost" || window.location.protocol === "file:") {
      els.previewUnlockButton.hidden = false;
    }
  }
}

async function loadTipRecipient() {
  try {
    const response = await fetch(`${apiBase}/api/tip-recipient`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Tip API ${response.status}`);
    const payload = await response.json();
    if (!payload.ok || !payload.recipientAddress) throw new Error(payload.error || "Recipient unavailable");
    state.tipRecipient = payload;
    els.tipRecipient.textContent = `${payload.recipientName} (${shortAddress(payload.recipientAddress)})`;
    els.tipButton.disabled = false;
  } catch (error) {
    els.tipRecipient.textContent = "Recipient unavailable";
    els.tipStatus.textContent = `Tip setup error: ${String(error.message || error)}`;
    els.tipButton.disabled = true;
  }
}

function updateGate() {
  const session = readSession();
  if (!session) {
    lockApp();
    return;
  }
  state.sessionExpiresAt = session.expiresAt;
  unlockApp();
  loadMenu();
}

async function leaveTip() {
  if (!state.tipRecipient?.recipientAddress) {
    els.tipStatus.textContent = "Recipient is not ready yet.";
    return;
  }

  els.tipButton.disabled = true;
  els.tipButton.textContent = "Sending tip";
  els.tipStatus.textContent = "Connect or confirm with your wallet. Access opens after the transaction is accepted.";

  try {
    const receipt = await sendTip();
    openSession(receipt);
  } catch (error) {
    els.tipStatus.textContent = walletErrorMessage(error);
  } finally {
    els.tipButton.disabled = false;
    els.tipButton.textContent = "Leave tip and enter";
  }
}

async function sendTip() {
  if (!state.walletProvider) {
    try {
      await connectWallet();
    } catch (error) {
      if (!state.sdk?.actions?.sendToken || !shouldTryProviderFallback(error)) throw error;
    }
  }

  if (state.walletProvider) {
    return sendTipWithEthereumProvider(state.walletProvider);
  }

  if (!state.sdk?.actions?.sendToken) {
    throw new Error("No wallet provider found");
  }

  const result = await state.sdk.actions.sendToken({
    token: state.tipRecipient.token.caip19,
    amount: state.tipAmount,
    recipientAddress: state.tipRecipient.recipientAddress,
  });

  if (result?.success) {
    return {
      transaction: result.send?.transaction,
      amount: state.tipAmount,
      recipientAddress: state.tipRecipient.recipientAddress,
      method: "sendToken",
    };
  }

  throw new Error(result?.error?.message || result?.reason || "Tip was not completed.");
}

async function connectWallet() {
  els.connectWalletButton.disabled = true;
  els.connectWalletButton.textContent = "Connecting";
  els.walletStatus.textContent = "Opening wallet...";

  try {
    const providers = await walletProviderCandidates();
    let lastError = null;

    for (const candidate of providers) {
      try {
        const accounts = await candidate.provider.request({ method: "eth_requestAccounts" });
        const address = Array.isArray(accounts) ? accounts[0] : "";
        if (!isEvmAddress(address)) throw new Error("Wallet not connected");
        await ensureBaseChain(candidate.provider);
        state.walletProvider = candidate.provider;
        state.walletAddress = address;
        state.walletKind = candidate.kind;
        updateWalletUi();
        els.tipStatus.textContent = "Wallet connected. You can leave the tip now.";
        return candidate.provider;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("No wallet provider found");
  } catch (error) {
    state.walletProvider = null;
    state.walletAddress = "";
    state.walletKind = "";
    updateWalletUi();
    els.tipStatus.textContent = walletErrorMessage(error);
    throw error;
  } finally {
    els.connectWalletButton.disabled = false;
    els.connectWalletButton.textContent = state.walletAddress ? "Wallet connected" : "Connect wallet";
  }
}

async function walletProviderCandidates() {
  const providers = [];
  const pushProvider = (kind, provider) => {
    if (provider?.request && !providers.some((candidate) => candidate.provider === provider)) {
      providers.push({ kind, provider });
    }
  };

  try {
    pushProvider("Farcaster", await state.sdk?.wallet?.getEthereumProvider?.());
  } catch {
    // Continue with browser wallets.
  }

  const injected = browserWalletProviders();
  injected.forEach((provider) => pushProvider(provider.kind, provider.provider));
  return providers;
}

function browserWalletProviders() {
  const injected = window.ethereum?.providers || (window.ethereum ? [window.ethereum] : []);
  const providers = injected.map((provider) => ({
    kind: provider.isCoinbaseWallet ? "Coinbase" : provider.isMetaMask ? "MetaMask" : "Browser wallet",
    provider,
  }));

  if (window.coinbaseWalletExtension?.request) {
    providers.push({ kind: "Coinbase", provider: window.coinbaseWalletExtension });
  }

  return providers;
}

async function sendTipWithEthereumProvider(provider) {
  if (!provider?.request) {
    throw new Error("Wallet provider unavailable");
  }

  const tokenAddress = tokenAddressFromCaip19(state.tipRecipient.token.caip19);
  if (!tokenAddress) throw new Error("Tip token unavailable");
  if (!isEvmAddress(state.tipRecipient.recipientAddress)) throw new Error("Tip recipient unavailable");

  const from = state.walletAddress || (await connectedWalletAddress(provider));
  if (!isEvmAddress(from)) throw new Error("Wallet not connected");

  await ensureBaseChain(provider);
  const transaction = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: tokenAddress,
        value: "0x0",
        data: encodeErc20Transfer(state.tipRecipient.recipientAddress, state.tipAmount),
      },
    ],
  });

  return {
    transaction,
    amount: state.tipAmount,
    recipientAddress: state.tipRecipient.recipientAddress,
    method: "eip1193",
  };
}

async function connectedWalletAddress(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) ? accounts[0] : "";
  if (isEvmAddress(address)) {
    state.walletProvider = provider;
    state.walletAddress = address;
    updateWalletUi();
  }
  return address;
}

async function ensureBaseChain(provider) {
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (String(currentChainId).toLowerCase() === baseChainId) return;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: baseChainId }] });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [baseChainParams] });
  }
}

function shouldTryProviderFallback(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    !text ||
    text.includes("wallet not connected") ||
    text.includes("not connected") ||
    text.includes("provider") ||
    text.includes("unsupported") ||
    text.includes("unavailable")
  );
}

function walletErrorMessage(error) {
  const message = String(error?.message || error || "unknown error");
  if (shouldTryProviderFallback(message)) {
    return "Wallet not connected. Use Connect wallet, or open Rektaurant from the Farcaster mobile app if Farcaster web cannot attach your wallet.";
  }
  return `Tip cancelled or failed: ${message}`;
}

function updateWalletUi() {
  if (!state.walletAddress) {
    els.walletStatus.textContent = "No wallet connected";
    els.connectWalletButton.textContent = "Connect wallet";
    return;
  }
  els.walletStatus.textContent = `${state.walletKind || "Wallet"} ${shortAddress(state.walletAddress)}`;
  els.connectWalletButton.textContent = "Wallet connected";
}

function openSession(receipt) {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  state.sessionExpiresAt = expiresAt;
  localStorage.setItem(
    tipSessionKey,
    JSON.stringify({
      expiresAt,
      receipt,
      openedAt: new Date().toISOString(),
    }),
  );
  els.tipStatus.textContent = "Tip received. Your table is ready for 10 minutes.";
  unlockApp();
  loadMenu({ force: true });
}

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(tipSessionKey) || "null");
    if (!session?.expiresAt || Number(session.expiresAt) <= Date.now()) {
      localStorage.removeItem(tipSessionKey);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(tipSessionKey);
    return null;
  }
}

function isSessionActive() {
  return Boolean(readSession());
}

function lockApp() {
  document.body.classList.remove("is-unlocked", "is-closed");
  document.body.classList.add("is-locked");
  els.appShell.setAttribute("aria-hidden", "true");
  els.closedGate.setAttribute("aria-hidden", "true");
  els.tipGate.removeAttribute("aria-hidden");
  els.closedGate.hidden = true;
  els.sessionTimer.hidden = true;
  window.clearInterval(state.sessionTimer);
  state.sessionTimer = null;
}

function unlockApp() {
  document.body.classList.remove("is-locked", "is-closed");
  document.body.classList.add("is-unlocked");
  els.appShell.removeAttribute("aria-hidden");
  els.tipGate.setAttribute("aria-hidden", "true");
  els.closedGate.setAttribute("aria-hidden", "true");
  els.closedGate.hidden = true;
  els.sessionTimer.hidden = false;
  startSessionTimer();
}

function startSessionTimer() {
  window.clearInterval(state.sessionTimer);
  updateSessionTimer();
  state.sessionTimer = window.setInterval(updateSessionTimer, 1000);
}

function updateSessionTimer() {
  const remaining = Math.max(0, state.sessionExpiresAt - Date.now());
  if (remaining <= 0) {
    localStorage.removeItem(tipSessionKey);
    lockApp();
    els.tipStatus.textContent = "Your 10 minute session expired. Leave another tip to re-enter.";
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  els.sessionTimer.textContent = `${minutes}:${seconds}`;
}

async function loadMenu({ force = false } = {}) {
  if (!state.mccOnline) {
    await checkMccAndUpdateGate({ force: true });
    return;
  }

  if (!isSessionActive()) {
    lockApp();
    return;
  }

  els.refreshButton.disabled = true;
  els.refreshButton.textContent = force ? "Refreshing" : "Loading";
  els.serviceStatus.classList.add("is-loading");

  try {
    const params = new URLSearchParams({
      limit: "14",
      minSetupScore: String(state.minSetupScore),
      operationMode: state.mode,
    });
    if (state.side) params.set("side", state.side);
    if (state.allowClientApiOverride && state.mccApiBase) params.set("apiBase", state.mccApiBase);

    const response = await fetch(`${apiBase}/api/menu?${params.toString()}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Menu API ${response.status}`);
    const menu = await response.json();
    state.dishes = Array.isArray(menu.dishes) ? menu.dishes : [];
    state.selectedId = state.dishes[0]?.id || null;
    renderSummary(menu);
    renderMenu();
    renderTicket(selectedDish());
    els.updatedAt.textContent = `Served ${formatDate(menu.generatedAt)} from ${sourceLabel(menu.source)}`;
    els.serviceStatus.textContent = menu.upstreamError ? "Rektaurant fallback kitchen" : menu.summary?.title || "Menu served";
  } catch (error) {
    els.serviceStatus.textContent = "Kitchen delay";
    els.menuList.innerHTML = `<div class="empty-state"><h3>Service paused</h3><p>${escapeHtml(String(error.message || error))}</p></div>`;
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.textContent = "Refresh menu";
    els.serviceStatus.classList.remove("is-loading");
  }
}

function renderSummary(menu) {
  els.sourceMetric.textContent = sourceLabel(menu.source);
  els.longMetric.textContent = String(menu.summary?.longCount ?? 0);
  els.shortMetric.textContent = String(menu.summary?.shortCount ?? 0);
  els.avgMetric.textContent = String(menu.summary?.averageSetup ?? 0);
}

function renderMenu() {
  const dishes = filteredDishes();
  els.menuList.innerHTML = "";

  if (dishes.length === 0) {
    els.menuList.innerHTML = '<div class="empty-state"><h3>No plates match the pass</h3><p>Try all sides or lower the minimum setup score.</p></div>';
    return;
  }

  dishes.forEach((dish) => {
    const node = els.dishTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = dish.id;
    node.classList.toggle("selected", dish.id === state.selectedId);
    node.classList.toggle("short", dish.side === "short");
    node.querySelector(".course").textContent = dish.course;
    node.querySelector("h3").textContent = dish.dishName;
    node.querySelector(".side-badge").textContent = dish.side.toUpperCase();
    node.querySelector(".plating").textContent = dish.plating;
    node.querySelector('[data-metric="setup"]').textContent = dish.scores.setup;
    node.querySelector('[data-metric="entry"]').textContent = dish.scores.entry;
    node.querySelector('[data-metric="ev"]').textContent = formatPercent(dish.expectedValuePct);
    node.querySelector(".confidence-track span").style.width = `${Math.max(5, Math.min(100, dish.confidence))}%`;
    node.addEventListener("click", () => {
      state.selectedId = dish.id;
      renderMenu();
      renderTicket(dish);
      maybeHaptic("selectionChanged");
    });
    els.menuList.append(node);
  });
}

function renderTicket(dish) {
  if (!dish) {
    els.ticket.innerHTML = '<p class="eyebrow">Chef\'s ticket</p><h2>Select a plate</h2><p class="muted">Pick any dish to inspect details.</p>';
    return;
  }

  const sideClass = dish.side === "short" ? "short-text" : "long-text";
  els.ticket.innerHTML = `
    <p class="eyebrow">Chef's ticket</p>
    <div class="ticket-title">
      <h2>${escapeHtml(dish.coin)} <span class="${sideClass}">${escapeHtml(dish.side.toUpperCase())}</span></h2>
      <span>${escapeHtml(dish.recommendation)}</span>
    </div>
    <p class="ticket-dish">${escapeHtml(dish.dishName)}</p>
    <div class="price-board">
      ${ticketMetric("Entry", formatUsd(dish.entryUsd))}
      ${ticketMetric("Target", formatUsd(dish.targetUsd))}
      ${ticketMetric("Invalidation", formatUsd(dish.invalidationUsd))}
      ${ticketMetric("R/R", dish.riskRewardRatio === null ? "n/a" : `${dish.riskRewardRatio}x`)}
      ${ticketMetric("Confidence", `${dish.confidence}%`)}
      ${ticketMetric("Size", dish.suggestedSizingPct ? `${dish.suggestedSizingPct}%` : "research")}
    </div>
    <div class="score-stack">
      ${scoreRow("Setup", dish.scores.setup)}
      ${scoreRow("Entry", dish.scores.entry)}
      ${scoreRow("Timing", dish.scores.timing)}
      ${scoreRow("Alpha", dish.scores.alpha)}
    </div>
    <section class="notes">
      <h3>Chef notes</h3>
      <ul>${dish.reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No notes served yet.</li>"}</ul>
    </section>
    <section class="notes warning-notes">
      <h3>Risk notes</h3>
      <ul>${dish.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No warnings returned by the source.</li>"}</ul>
    </section>
  `;
}

async function shareSpecial(target = "farcaster") {
  const { text, url } = shareCopy();
  if (target === "twitter") {
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", text);
    intent.searchParams.set("url", url);
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
    els.serviceStatus.textContent = "Twitter special plated";
    return;
  }

  if (state.sdk?.actions?.composeCast) {
    try {
      await state.sdk.actions.composeCast({ text, embeds: [url] });
      maybeHaptic("impactOccurred");
      return;
    } catch {
      // Fall through to clipboard.
    }
  }
  await navigator.clipboard?.writeText(`${text} ${url}`);
  els.serviceStatus.textContent = "Farcaster special copied";
}

function shareCopy() {
  const dish = selectedDish() || filteredDishes()[0];
  const text = dish
    ? `You didn't eat? Don't waste that delicious alpha. Rektaurant is serving ${dish.coin} ${dish.side.toUpperCase()} as ${dish.dishName}. Hot long/short signals, plated with risk notes.`
    : "You didn't eat? Don't waste that delicious alpha. Rektaurant is serving hot Hyperliquid long/short signal plates with risk notes.";

  return {
    text,
    url: window.location.origin === "null" ? "https://rektaurant.vercel.app/" : window.location.href,
  };
}

function bindFarcasterEvents() {
  state.sdk?.on?.("miniappAdded", async () => {
    setNotificationUi("Checking notifications");
    await refreshFarcasterContext();
    const synced = await syncNotificationStateFromContext();
    if (!synced) {
      setNotificationUi("Enable notifications");
      els.serviceStatus.textContent = "App saved";
      els.tipStatus.textContent = "Rektaurant is saved. If Farcaster did not enable notifications, turn them on from the app settings.";
    }
  });
  state.sdk?.on?.("notificationsEnabled", async () => {
    setNotificationUi("Checking notifications");
    await refreshFarcasterContext();
    const synced = await syncNotificationStateFromContext();
    if (!synced) {
      setNotificationUi("Enable notifications");
      els.tipStatus.textContent = "Farcaster says notifications changed, but no token is visible yet. Refresh Rektaurant and try again.";
    }
  });
  state.sdk?.on?.("notificationsDisabled", () => {
    setNotificationUi("Turn on notifications");
    els.serviceStatus.textContent = "Notifications off";
  });
  state.sdk?.on?.("miniappRemoved", () => {
    setNotificationUi("Turn on notifications");
    els.serviceStatus.textContent = "App removed";
  });
}

async function turnOnNotifications() {
  if (!state.sdk?.actions?.addMiniApp) {
    els.tipStatus.textContent = "Open Rektaurant inside Farcaster to turn on notifications.";
    els.serviceStatus.textContent = "Notifications work inside Farcaster";
    return;
  }

  setNotificationUi("Opening Farcaster");
  els.gateNotifyButton.disabled = true;
  els.saveButton.disabled = true;

  try {
    await state.sdk.actions.addMiniApp();
    setNotificationUi("Checking notifications");
    els.serviceStatus.textContent = "Checking notification token";
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    await refreshFarcasterContext();
    const synced = await syncNotificationStateFromContext();
    if (!synced) {
      setNotificationUi("Enable notifications");
      els.serviceStatus.textContent = "App saved";
      els.tipStatus.textContent = "Rektaurant was saved, but no notification token arrived yet. If Farcaster shows a notification toggle, enable it there.";
    }
  } catch (error) {
    setNotificationUi("Turn on notifications");
    const message = String(error?.message || error || "");
    if (message.includes("RejectedByUser")) {
      els.tipStatus.textContent = "Notifications were not enabled.";
      els.serviceStatus.textContent = "Notifications skipped";
    } else {
      els.tipStatus.textContent = "Farcaster could not enable notifications here. Try from the Farcaster mobile app or refresh the mini app.";
      els.serviceStatus.textContent = "Notification setup failed";
    }
  } finally {
    els.gateNotifyButton.disabled = false;
    els.saveButton.disabled = false;
  }
}

function setNotificationUi(label) {
  els.gateNotifyButton.textContent = label;
  els.saveButton.textContent = label;
}

async function refreshFarcasterContext() {
  try {
    state.farcasterContext = await state.sdk.context;
  } catch {
    // Keep the previous context if the host does not refresh it.
  }
  return state.farcasterContext;
}

async function syncNotificationStateFromContext({ silent = false } = {}) {
  const client = state.farcasterContext?.client;
  const details = client?.notificationDetails;

  if (details?.token && details?.url) {
    const stored = await syncNotificationDetails(details);
    if (stored) {
      setNotificationUi("Notifications on");
      els.serviceStatus.textContent = "Notifications ready";
      if (!silent) {
        els.tipStatus.textContent = "Notifications are on. The kitchen can call you back when hot long/short dishes land.";
      }
      return true;
    }
  }

  if (client?.added) {
    setNotificationUi("Enable notifications");
    if (!silent) {
      els.serviceStatus.textContent = "App saved";
    }
    return false;
  }

  setNotificationUi("Turn on notifications");
  return false;
}

async function syncNotificationDetails(notificationDetails) {
  try {
    const response = await fetch(`${apiBase}/api/notifications/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        fid: state.farcasterContext?.user?.fid,
        notificationDetails,
      }),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return Boolean(payload.ok && payload.stored);
  } catch {
    return false;
  }
}

function maybeHaptic(type) {
  const haptics = state.sdk?.haptics || state.sdk?.actions?.haptics;
  try {
    if (type === "selectionChanged") haptics?.selectionChanged?.();
    if (type === "impactOccurred") haptics?.impactOccurred?.("light");
  } catch {
    // Haptics are optional host capabilities.
  }
}

function filteredDishes() {
  return state.side ? state.dishes.filter((dish) => dish.side === state.side) : state.dishes;
}

function selectedDish() {
  return filteredDishes().find((dish) => dish.id === state.selectedId) || filteredDishes()[0] || null;
}

function setActive(selector, activeButton) {
  document.querySelectorAll(selector).forEach((button) => button.classList.toggle("active", button === activeButton));
}

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function tokenAddressFromCaip19(value) {
  const match = String(value || "").match(/\/erc20:(0x[a-fA-F0-9]{40})$/);
  return match?.[1] || "";
}

function encodeErc20Transfer(recipientAddress, amount) {
  const recipient = String(recipientAddress || "").replace(/^0x/i, "").padStart(64, "0");
  const value = BigInt(String(amount || "0")).toString(16).padStart(64, "0");
  return `0xa9059cbb${recipient}${value}`;
}

function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function ticketMetric(label, value) {
  return `<span><small>${label}</small><strong>${value}</strong></span>`;
}

function scoreRow(label, value) {
  const width = Math.max(4, Math.min(100, Number(value) || 0));
  return `<div class="score-row"><span>${label}</span><div><i style="width:${width}%"></i></div><strong>${value}</strong></div>`;
}

function sourceLabel(source) {
  if (source === "mcc") return "MCC";
  if (source === "hyperliquid-direct") return "Hyperliquid";
  return source || "Local";
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const digits = number >= 1000 ? 1 : number >= 1 ? 4 : 6;
  return `$${number.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortAddress(value) {
  const text = String(value || "");
  return text.length > 12 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
}
