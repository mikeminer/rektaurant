const state = {
  mode: "opportunistic",
  side: "",
  minSetupScore: 24,
  dishes: [],
  selectedId: null,
  lastMenu: null,
  sdk: null,
  farcasterContext: null,
  isMiniApp: false,
  tipRecipient: null,
  tipAmount: "500000000000000",
  sessionExpiresAt: 0,
  sessionTimer: null,
  mccApiBase: "",
  allowClientApiOverride: false,
  mccOnline: false,
  walletProvider: null,
  walletAddress: "",
  walletKind: "",
  stacksVault: null,
  stacksWalletAddress: "",
  stacksWalletKind: "",
  notificationAction: "add",
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
const celoChainId = "0xa4ec";
const celoChainParams = {
  chainId: celoChainId,
  chainName: "Celo Mainnet",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: ["https://forno.celo.org"],
  blockExplorerUrls: ["https://celoscan.io"],
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
  monthlyPassButton: document.querySelector("#monthlyPassButton"),
  miniPayButton: document.querySelector("#miniPayButton"),
  stacksVaultButton: document.querySelector("#stacksVaultButton"),
  connectStacksWalletButton: document.querySelector("#connectStacksWalletButton"),
  stacksVaultExplorerLink: document.querySelector("#stacksVaultExplorerLink"),
  stacksVaultPrice: document.querySelector("#stacksVaultPrice"),
  stacksWalletStatus: document.querySelector("#stacksWalletStatus"),
  gateNotifyButton: document.querySelector("#gateNotifyButton"),
  connectWalletButton: document.querySelector("#connectWalletButton"),
  walletStatus: document.querySelector("#walletStatus"),
  sessionTimer: document.querySelector("#sessionTimer"),
  serviceStatus: document.querySelector("#serviceStatus"),
  serviceTitle: document.querySelector("#service-title"),
  serviceNote: document.querySelector("#serviceNote"),
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
  missedCallout: document.querySelector("#missedCallout"),
  missedNotifyButton: document.querySelector("#missedNotifyButton"),
};

boot();

async function boot() {
  await loadAppConfig();
  bindControls();
  initMiniPayUi();
  await initFarcaster();
  if (!state.isMiniApp && (window.location.hostname === "localhost" || window.location.protocol === "file:")) {
    els.previewUnlockButton.hidden = false;
  }
  await loadTipRecipient();
  await checkMccAndUpdateGate();
  window.setInterval(() => {
    if (isSessionActive() && state.mccOnline) loadMenu();
  }, 120000);
  window.setInterval(updatePlateAgeLabels, 30000);
}

function bindControls() {
  els.retryHealthButton.addEventListener("click", () => checkMccAndUpdateGate({ force: true }));

  els.tipButton.addEventListener("click", leaveTip);
  els.monthlyPassButton.addEventListener("click", buyMonthlyPass);
  els.miniPayButton.addEventListener("click", payWithMiniPay);
  els.stacksVaultButton.addEventListener("click", supportStacksVault);
  els.connectStacksWalletButton.addEventListener("click", () => connectStacksWallet({ forceWalletSelect: true }).catch(() => {}));
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
  els.missedNotifyButton.addEventListener("click", turnOnNotifications);

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      setActive("[data-mode]", button);
      updateModeCopy();
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
  updateModeCopy();
}

function initMiniPayUi() {
  if (!isMiniPayProvider(window.ethereum)) return;
  document.body.classList.add("is-minipay");
  els.connectWalletButton.hidden = true;
  els.walletStatus.textContent = "MiniPay wallet detected";
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
    const { sdk } = await import("https://esm.sh/@farcaster/miniapp-sdk@0.3.0");
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
    state.stacksVault = payload.stacksVault || null;
    els.tipRecipient.textContent = `${payload.recipientName} (${shortAddress(payload.recipientAddress)})`;
    els.tipButton.disabled = false;
    els.monthlyPassButton.disabled = !payload.monthlyPass?.recipientAddress;
    els.miniPayButton.disabled = !payload.miniPayAccess?.recipientAddress;
    updateStacksVaultUi();
  } catch (error) {
    els.tipRecipient.textContent = "Recipient unavailable";
    els.tipStatus.textContent = `Tip setup error: ${String(error.message || error)}`;
    els.tipButton.disabled = true;
    els.monthlyPassButton.disabled = true;
    els.miniPayButton.disabled = true;
    els.stacksVaultButton.disabled = true;
  }
}

function updateStacksVaultUi() {
  const vault = state.stacksVault;
  els.stacksVaultPrice.textContent = vault?.amountLabel || "0.1 STX";
  if (!vault?.enabled || !vault?.contractId) {
    els.stacksVaultButton.disabled = true;
    els.stacksVaultButton.textContent = "Deploy Stacks vault first";
    els.connectStacksWalletButton.disabled = true;
    els.connectStacksWalletButton.textContent = "Connect Stacks wallet";
    els.stacksWalletStatus.textContent = "Stacks vault unavailable";
    els.stacksVaultExplorerLink.hidden = true;
    return;
  }

  els.connectStacksWalletButton.disabled = false;
  els.connectStacksWalletButton.textContent = state.stacksWalletAddress ? "Stacks wallet connected" : "Connect Stacks wallet";
  els.stacksWalletStatus.textContent = state.stacksWalletAddress
    ? `${state.stacksWalletKind || "Stacks wallet"} ${shortAddress(state.stacksWalletAddress)}`
    : "No Stacks wallet connected";
  els.stacksVaultButton.disabled = !state.stacksWalletAddress;
  els.stacksVaultButton.textContent = state.stacksWalletAddress ? "Pay STX vault" : "Connect Stacks first";
  els.stacksVaultExplorerLink.href = vault.explorerUrl || "https://explorer.hiro.so/";
  els.stacksVaultExplorerLink.hidden = false;
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
  els.tipButton.textContent = "Sending ETH";
  els.tipStatus.textContent = "Connect or confirm with your wallet. Your 10 minute table opens after the ETH transaction is accepted.";

  try {
    const receipt = await sendAccessPayment({
      kind: "eth-tip",
      token: state.tipRecipient.token,
      amount: state.tipAmount,
      recipientAddress: state.tipRecipient.recipientAddress,
      sessionSeconds: state.tipRecipient.sessionSeconds || 10 * 60,
      accessLabel: "10 minutes",
      chainId: baseChainId,
      chainParams: baseChainParams,
    });
    openSession(receipt);
  } catch (error) {
    els.tipStatus.textContent = walletErrorMessage(error);
  } finally {
    els.tipButton.disabled = false;
    els.tipButton.textContent = "Tip ETH and enter";
  }
}

async function buyMonthlyPass() {
  const pass = state.tipRecipient?.monthlyPass;
  if (!pass?.recipientAddress || !pass?.token) {
    els.tipStatus.textContent = "Monthly pass is not ready yet.";
    return;
  }

  els.monthlyPassButton.disabled = true;
  els.monthlyPassButton.textContent = "Buying monthly pass";
  els.tipStatus.textContent = "Buy the monthly pass for 10,000,000 pappardelle token on Base. Your table opens after the transaction is accepted.";

  try {
    const receipt = await sendAccessPayment({
      kind: "monthly-pappardelle-pass",
      token: pass.token,
      amount: pass.amount,
      recipientAddress: pass.recipientAddress,
      sessionSeconds: pass.sessionSeconds || 30 * 24 * 60 * 60,
      accessLabel: "1 month",
      chainId: baseChainId,
      chainParams: baseChainParams,
    });
    openSession(receipt);
  } catch (error) {
    els.tipStatus.textContent = walletErrorMessage(error);
  } finally {
    els.monthlyPassButton.disabled = false;
    els.monthlyPassButton.textContent = "Buy monthly pass";
  }
}

async function payWithMiniPay() {
  const access = state.tipRecipient?.miniPayAccess;
  if (!access?.recipientAddress || !access?.token) {
    els.tipStatus.textContent = "MiniPay access is not ready yet.";
    return;
  }

  if (!isMiniPayProvider(window.ethereum)) {
    els.tipStatus.textContent = "Open Rektaurant inside MiniPay to pay 1 USDm on Celo for a 10 minute table.";
    return;
  }

  els.miniPayButton.disabled = true;
  els.miniPayButton.textContent = "Opening MiniPay";
  els.tipStatus.textContent = "Confirm 1 USDm in MiniPay on Celo. Your 10 minute table opens after the transaction is accepted.";

  try {
    const receipt = await sendMiniPayAccess(window.ethereum, access);
    openSession(receipt);
  } catch (error) {
    els.tipStatus.textContent = walletErrorMessage(error);
  } finally {
    els.miniPayButton.disabled = false;
    els.miniPayButton.textContent = "Pay with MiniPay";
  }
}

async function sendMiniPayAccess(provider, access) {
  state.walletProvider = provider;
  state.walletKind = "MiniPay";
  return sendPaymentWithEthereumProvider(provider, {
    kind: "minipay-usdm-access",
    token: access.token,
    amount: access.amount,
    recipientAddress: access.recipientAddress,
    sessionSeconds: access.sessionSeconds || 10 * 60,
    accessLabel: "MiniPay access",
    chainId: access.chainId || celoChainId,
    chainParams: celoChainParams,
    feeCurrency: access.token.address,
    method: "minipay",
  });
}

async function supportStacksVault() {
  const vault = state.stacksVault;
  if (!vault?.enabled || !vault?.contractId) {
    els.tipStatus.textContent = "Stacks vault is ready in the code. Deploy the contract and set REKTAURANT_STACKS_CONTRACT_ID on Vercel to enable it.";
    return;
  }

  try {
    if (!state.stacksWalletAddress) {
      els.tipStatus.textContent = "Choose and connect a Stacks wallet first, then pay the vault plate.";
      await connectStacksWallet({ forceWalletSelect: true });
    }

    els.stacksVaultButton.disabled = true;
    els.stacksVaultButton.textContent = "Opening Stacks wallet";
    els.tipStatus.textContent = `Confirm the ${vault.amountLabel} vault deposit. Your 10 minute table opens after the transaction is accepted.`;
    const receipt = await sendStacksVaultDeposit(vault);
    openSession(receipt);
  } catch (error) {
    els.tipStatus.textContent = stacksWalletErrorMessage(error);
  } finally {
    updateStacksVaultUi();
  }
}

async function connectStacksWallet({ forceWalletSelect = true } = {}) {
  const vault = state.stacksVault;
  if (!vault?.enabled || !vault?.contractId) {
    els.tipStatus.textContent = "Stacks vault is not enabled yet.";
    return null;
  }

  els.connectStacksWalletButton.disabled = true;
  els.connectStacksWalletButton.textContent = "Connecting Stacks";
  els.stacksWalletStatus.textContent = "Choose Leather, Xverse, or another Stacks wallet...";

  try {
    const { connect } = await import("https://esm.sh/@stacks/connect");
    const result = await connect({
      network: stacksNetwork(vault.network),
      forceWalletSelect,
      persistWalletSelect: true,
    });
    const addressEntry = stacksAddressFromConnectResult(result);
    if (!addressEntry?.address) throw new Error("No STX address returned by the wallet.");

    state.stacksWalletAddress = addressEntry.address;
    state.stacksWalletKind = addressEntry.symbol || "Stacks";
    updateStacksVaultUi();
    els.tipStatus.textContent = "Stacks wallet connected. Pay the STX vault to open a 10 minute table.";
    return addressEntry;
  } catch (error) {
    state.stacksWalletAddress = "";
    state.stacksWalletKind = "";
    updateStacksVaultUi();
    els.tipStatus.textContent = stacksWalletErrorMessage(error);
    throw error;
  } finally {
    els.connectStacksWalletButton.disabled = false;
    updateStacksVaultUi();
  }
}

async function sendStacksVaultDeposit(vault) {
  const [{ request }, { Cl }] = await Promise.all([
    import("https://esm.sh/@stacks/connect"),
    import("https://esm.sh/@stacks/transactions"),
  ]);
  const memo = "Rektaurant vault";
  const result = await request(
    {
      persistWalletSelect: true,
      enableLocalStorage: true,
    },
    "stx_callContract",
    {
      contract: vault.contractId,
      functionName: "deposit",
      functionArgs: [Cl.uint(BigInt(String(vault.amount || "0"))), Cl.stringAscii(memo)],
      network: stacksNetwork(vault.network),
      postConditionMode: "allow",
    },
  );
  const txid = result?.txid || result?.txId || result?.transaction;
  if (!txid) throw new Error("Stacks vault transaction was not returned by the wallet.");

  return {
    transaction: txid,
    amount: vault.amount,
    recipientAddress: vault.contractId,
    senderAddress: state.stacksWalletAddress,
    token: { symbol: "STX", chain: "Stacks" },
    sessionSeconds: vault.sessionSeconds || 10 * 60,
    accessLabel: "Stacks vault access",
    kind: "stacks-vault-deposit",
    method: "stacks-connect",
  };
}

async function sendAccessPayment(payment) {
  if (!state.walletProvider) {
    try {
      await connectWallet();
    } catch (error) {
      if (!state.sdk?.actions?.sendToken || !shouldTryProviderFallback(error)) throw error;
    }
  }

  if (state.walletProvider) {
    return sendPaymentWithEthereumProvider(state.walletProvider, payment);
  }

  if (!state.sdk?.actions?.sendToken) {
    throw new Error("No wallet provider found");
  }

  const result = await state.sdk.actions.sendToken({
    token: payment.token.caip19,
    amount: payment.amount,
    recipientAddress: payment.recipientAddress,
  });

  if (result?.success) {
    return {
      transaction: result.send?.transaction,
      amount: payment.amount,
      recipientAddress: payment.recipientAddress,
      token: payment.token,
      sessionSeconds: payment.sessionSeconds,
      accessLabel: payment.accessLabel,
      kind: payment.kind,
      method: "sendToken",
    };
  }

  throw new Error(result?.error?.message || result?.reason || "Payment was not completed.");
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
        await ensurePaymentChain(candidate.provider, { chainId: baseChainId, chainParams: baseChainParams });
        state.walletProvider = candidate.provider;
        state.walletAddress = address;
        state.walletKind = candidate.kind;
        updateWalletUi();
        els.tipStatus.textContent = "Wallet connected. Choose the ETH tip, MiniPay, or the monthly pass.";
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
    kind: provider.isMiniPay ? "MiniPay" : provider.isCoinbaseWallet ? "Coinbase" : provider.isMetaMask ? "MetaMask" : "Browser wallet",
    provider,
  }));

  if (window.coinbaseWalletExtension?.request) {
    providers.push({ kind: "Coinbase", provider: window.coinbaseWalletExtension });
  }

  return providers;
}

async function sendPaymentWithEthereumProvider(provider, payment) {
  if (!provider?.request) {
    throw new Error("Wallet provider unavailable");
  }

  if (!payment?.token?.caip19) throw new Error("Payment token unavailable");
  if (!isEvmAddress(payment.recipientAddress)) throw new Error("Payment recipient unavailable");

  const from = state.walletAddress || (await connectedWalletAddress(provider));
  if (!isEvmAddress(from)) throw new Error("Wallet not connected");

  await ensurePaymentChain(provider, payment);
  const transactionParams = isNativeToken(payment.token)
    ? {
        from,
        to: payment.recipientAddress,
        value: bigintToHex(payment.amount),
      }
    : {
        from,
        to: tokenAddressFromCaip19(payment.token.caip19) || payment.token.address,
        value: "0x0",
        data: encodeErc20Transfer(payment.recipientAddress, payment.amount),
      };

  if (payment.feeCurrency) transactionParams.feeCurrency = payment.feeCurrency;

  if (!isEvmAddress(transactionParams.to)) throw new Error("Payment token unavailable");

  const transaction = await provider.request({
    method: "eth_sendTransaction",
    params: [transactionParams],
  });

  return {
    transaction,
    amount: payment.amount,
    recipientAddress: payment.recipientAddress,
    token: payment.token,
    sessionSeconds: payment.sessionSeconds,
    accessLabel: payment.accessLabel,
    kind: payment.kind,
    method: payment.method || "eip1193",
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

async function ensurePaymentChain(provider, payment = {}) {
  const chainId = payment.chainId || baseChainId;
  const chainParams = payment.chainParams || baseChainParams;
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (String(currentChainId).toLowerCase() === chainId) return;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [chainParams] });
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
  return `Payment cancelled or failed: ${message}`;
}

function stacksWalletErrorMessage(error) {
  const message = String(error?.message || error || "unknown error");
  if (message.toLowerCase().includes("usercanceled") || message.toLowerCase().includes("cancel")) {
    return "Stacks wallet connection was cancelled.";
  }
  if (message.toLowerCase().includes("no wallet") || message.toLowerCase().includes("provider")) {
    return "No Stacks wallet found. Install or open Leather/Xverse, then connect the Stacks wallet.";
  }
  return `Stacks wallet failed: ${message}`;
}

function stacksNetwork(value) {
  return value === "testnet" ? "testnet" : "mainnet";
}

function stacksAddressFromConnectResult(result) {
  const addresses = Array.isArray(result?.addresses) ? result.addresses : [];
  return (
    addresses.find((entry) => String(entry?.symbol || "").toUpperCase() === "STX") ||
    addresses.find((entry) => isStacksAddress(entry?.address)) ||
    null
  );
}

function isStacksAddress(value) {
  return /^S[PT][0-9A-Z]{20,}$/.test(String(value || ""));
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
  const sessionSeconds = Number(receipt?.sessionSeconds || 10 * 60);
  const expiresAt = Date.now() + sessionSeconds * 1000;
  state.sessionExpiresAt = expiresAt;
  localStorage.setItem(
    tipSessionKey,
    JSON.stringify({
      expiresAt,
      receipt,
      openedAt: new Date().toISOString(),
    }),
  );
  els.tipStatus.textContent = `${receipt?.accessLabel || "Access"} received. Your table is ready.`;
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
    els.tipStatus.textContent = "Your Rektaurant session expired. Tip ETH or buy a pappardelle monthly pass to re-enter.";
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const totalSeconds = Math.ceil(remaining / 1000);
  if (totalSeconds >= 24 * 60 * 60) {
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
    els.sessionTimer.textContent = `${days}d ${hours}h`;
    return;
  }
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    els.sessionTimer.textContent = `${hours}h ${minutes}m`;
    return;
  }
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
    state.lastMenu = menu;
    state.dishes = Array.isArray(menu.dishes) ? menu.dishes : [];
    state.selectedId = state.dishes[0]?.id || null;
    renderSummary(menu);
    renderMenu();
    renderTicket(selectedDish());
    els.updatedAt.textContent = `Served ${formatDate(menu.generatedAt)} from ${sourceLabel(menu.source)}`;
    els.serviceStatus.textContent = menu.upstreamError ? "Premium feed paused" : menu.summary?.title || "Menu served";
  } catch (error) {
    els.serviceStatus.textContent = "Kitchen delay";
    els.menuList.innerHTML = `<div class="empty-state"><h3>Service paused</h3><p>${escapeHtml(String(error.message || error))}</p></div>`;
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.textContent = modeCopy(state.mode).refreshLabel;
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
  const hasMissedPlates = dishes.some(isMissedDish);
  els.missedCallout.hidden = !hasMissedPlates;

  if (dishes.length === 0) {
    const empty = state.mode === "wave-rider"
      ? {
          title: "No Wave Rider bites right now",
          body: "Fast food stays off the pass when the wave is cold. Turn on notifications so the next hot bite reaches you fresh.",
        }
      : {
          title: "No executive plates right now",
          body: "The premium MCC v2 feed has no fresh active plate that passes EV, risk/reward, memory and stale-signal filters. Turn on notifications to catch the next one hot.",
        };
    els.menuList.innerHTML = `<div class="empty-state"><h3>${empty.title}</h3><p>${empty.body}</p></div>`;
    return;
  }

  dishes.forEach((dish) => {
    const node = els.dishTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = dish.id;
    node.classList.toggle("selected", dish.id === state.selectedId);
    node.classList.toggle("short", dish.side === "short");
    node.classList.toggle("missed", isMissedDish(dish));
    node.querySelector(".course").textContent = dish.course;
    node.querySelector("h3").textContent = dish.dishName;
    node.querySelector(".side-badge").textContent = dish.side.toUpperCase();
    node.querySelector(".plating").textContent = dish.plating;
    node.querySelector(".plate-age").textContent = plateAgeLabel(dish);
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

function updateModeCopy() {
  const copy = modeCopy(state.mode);
  els.serviceTitle.textContent = copy.title;
  els.serviceNote.textContent = copy.note;
  els.refreshButton.textContent = copy.refreshLabel;
}

function modeCopy(mode) {
  if (mode === "wave-rider") {
    return {
      title: "Wave Rider fast food",
      note: "Fast food signals for short-duration waves. Hot plates, quick bites, strict invalidation.",
      refreshLabel: "Refresh waves",
    };
  }
  if (mode === "strict") {
    return {
      title: "Executive plates only",
      note: "Tighter filters for cleaner setups. Still read-only research: reprice, check spread and control risk before acting.",
      refreshLabel: "Refresh menu",
    };
  }
  if (mode === "balanced") {
    return {
      title: "Balanced long and short dishes",
      note: "A middle service between hot opportunities and cleaner risk filters. No orders, no signatures, no custody.",
      refreshLabel: "Refresh menu",
    };
  }
  return {
    title: "Long and short dishes from the MCC kitchen",
    note: "Read-only signal research. No orders, no signatures, no custody. Every plate still needs repricing, spread checks and risk control.",
    refreshLabel: "Refresh menu",
  };
}

function renderTicket(dish) {
  if (!dish) {
    els.ticket.innerHTML = '<div class="ticket-plate" aria-hidden="true"></div><p class="eyebrow">Chef\'s ticket</p><h2>Select a plate</h2><p class="muted">Pick any dish to inspect details.</p>';
    return;
  }

  const sideClass = dish.side === "short" ? "short-text" : "long-text";
  const missedNotice = isMissedDish(dish)
    ? '<p class="ticket-alert">Past expired signal missed. Turn on notifications to catch the next hot plate as soon as it leaves the kitchen.</p>'
    : "";
  els.ticket.innerHTML = `
    <div class="ticket-plate ${dish.side === "short" ? "short" : ""}" aria-hidden="true"></div>
    <p class="eyebrow">Chef's ticket</p>
    <div class="ticket-title">
      <h2>${escapeHtml(dish.coin)} <span class="${sideClass}">${escapeHtml(dish.side.toUpperCase())}</span></h2>
      <span>${escapeHtml(dish.recommendation)}</span>
    </div>
    <p class="ticket-dish">${escapeHtml(dish.dishName)}</p>
    ${missedNotice}
    <div class="price-board">
      ${ticketMetric("Entry", formatUsd(dish.entryUsd))}
      ${ticketMetric("Target", formatUsd(dish.targetUsd))}
      ${ticketMetric("Invalidation", formatUsd(dish.invalidationUsd))}
      ${ticketMetric("R/R", dish.riskRewardRatio === null ? "n/a" : `${dish.riskRewardRatio}x`)}
      ${ticketMetric("Confidence", `${dish.confidence}%`)}
      ${ticketMetric("Plate age", plateAgeLabel(dish), "ticket-age")}
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
  const { text, url } = shareCopy(target);
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

function shareCopy(target = "farcaster") {
  const dish = selectedDish() || filteredDishes()[0];
  if (state.mode === "wave-rider") {
    return {
      text: dish
        ? `Wave Rider is serving ${dish.coin} ${dish.side.toUpperCase()} fast food: hot plate, quick bite, strict invalidation.`
        : "Wave Rider is Rektaurant fast food: short-duration waves, hot plates, quick bites, strict invalidation.",
      url: shareUrl(target),
    };
  }
  const text = dish
    ? `You didn't eat? Don't waste that delicious alpha. Rektaurant is serving ${dish.coin} ${dish.side.toUpperCase()} as ${dish.dishName}. Base mini app signal plates with risk notes.`
    : "You didn't eat? Don't waste that delicious alpha. Rektaurant is serving hot Base mini app signal plates with Hyperliquid long/short risk notes.";

  return {
    text,
    url: shareUrl(target),
  };
}

function shareUrl(target = "farcaster") {
  const url = new URL(window.location.origin === "null" ? "https://rektaurant.vercel.app/" : window.location.href);
  url.searchParams.set("utm_source", target === "twitter" ? "twitter" : "farcaster");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "rektaurant_base_signals");
  return url.toString();
}

function bindFarcasterEvents() {
  state.sdk?.on?.("miniappAdded", async (event = {}) => {
    setNotificationUi("Checking notifications");
    const synced = await syncNotificationDetailsFromHost(event.notificationDetails);
    if (!synced) await refreshFarcasterContext();
    const contextSynced = synced || (await syncNotificationStateFromContext());
    if (!contextSynced) {
      setNotificationUi("Notification settings", "settings");
      els.serviceStatus.textContent = "App saved";
      els.tipStatus.textContent = "Rektaurant is saved. Open Farcaster settings, enable Rektaurant notifications, then return and tap Check notifications.";
    }
  });
  state.sdk?.on?.("notificationsEnabled", async (event = {}) => {
    setNotificationUi("Checking notifications");
    const synced = await syncNotificationDetailsFromHost(event.notificationDetails);
    if (!synced) await refreshFarcasterContext();
    const contextSynced = synced || (await syncNotificationStateFromContext());
    if (!contextSynced) {
      setNotificationUi("Notification settings", "settings");
      els.tipStatus.textContent = "Farcaster says notifications changed, but no token is visible yet. Open settings and confirm Rektaurant notifications are enabled.";
    }
  });
  state.sdk?.on?.("notificationsDisabled", () => {
    setNotificationUi("Notification settings", "settings");
    els.serviceStatus.textContent = "Notifications off";
  });
  state.sdk?.on?.("miniappRemoved", () => {
    setNotificationUi("Turn on notifications");
    els.serviceStatus.textContent = "App removed";
  });
}

async function turnOnNotifications() {
  if (state.notificationAction === "settings") {
    await openNotificationSettings();
    return;
  }

  if (state.notificationAction === "check") {
    await checkNotificationState();
    return;
  }

  if (state.notificationAction === "ready") {
    els.tipStatus.textContent = "Notifications are already on. Hot long/short plates can reach you.";
    return;
  }

  if (!state.sdk?.actions?.addMiniApp) {
    els.tipStatus.textContent = "Open Rektaurant inside Farcaster to turn on notifications.";
    els.serviceStatus.textContent = "Notifications work inside Farcaster";
    return;
  }

  setNotificationUi("Opening Farcaster");
  els.gateNotifyButton.disabled = true;
  els.saveButton.disabled = true;

  try {
    await refreshFarcasterContext();
    if (await syncNotificationStateFromContext({ silent: true })) return;
    if (state.farcasterContext?.client?.added && !state.farcasterContext?.client?.notificationDetails) {
      await openNotificationSettings();
      return;
    }

    const result = await state.sdk.actions.addMiniApp();
    setNotificationUi("Checking notifications");
    els.serviceStatus.textContent = "Checking notification token";
    const syncedFromAction = await syncNotificationDetailsFromHost(result?.notificationDetails);
    if (syncedFromAction) return;
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    await refreshFarcasterContext();
    const synced = await syncNotificationStateFromContext();
    if (!synced) {
      setNotificationUi("Notification settings", "settings");
      els.serviceStatus.textContent = "App saved";
      els.tipStatus.textContent = "Rektaurant is saved, but no token arrived yet. Open Farcaster settings, enable Rektaurant notifications, then return here.";
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

async function openNotificationSettings() {
  setNotificationUi("Opening settings", "settings");
  els.serviceStatus.textContent = "Open Rektaurant settings";
  els.tipStatus.textContent = "In Farcaster settings, open Notifications or Saved Mini Apps, select Rektaurant, enable notifications, then return and tap Check notifications.";
  els.gateNotifyButton.disabled = true;
  els.saveButton.disabled = true;

  try {
    const settingsUrl = "https://farcaster.xyz/~/settings";
    if (state.sdk?.actions?.openUrl) {
      await state.sdk.actions.openUrl(settingsUrl);
    } else {
      window.open(settingsUrl, "_blank", "noopener,noreferrer");
    }
  } catch {
    els.tipStatus.textContent = "Could not open Farcaster settings from here. Open Farcaster settings manually, enable Rektaurant notifications, then return and tap Check notifications.";
  } finally {
    els.gateNotifyButton.disabled = false;
    els.saveButton.disabled = false;
    setNotificationUi("Check notifications", "check");
  }
}

async function checkNotificationState() {
  setNotificationUi("Checking notifications", "check");
  els.gateNotifyButton.disabled = true;
  els.saveButton.disabled = true;

  try {
    await refreshFarcasterContext();
    const synced = await syncNotificationStateFromContext();
    if (!synced) {
      setNotificationUi("Notification settings", "settings");
      els.serviceStatus.textContent = "Token still missing";
      els.tipStatus.textContent = "No notification token is visible yet. In Farcaster settings, make sure Rektaurant notifications are enabled, then reopen the mini app.";
    }
  } finally {
    els.gateNotifyButton.disabled = false;
    els.saveButton.disabled = false;
  }
}

function setNotificationUi(label, action = notificationActionForLabel(label)) {
  state.notificationAction = action;
  els.gateNotifyButton.textContent = label;
  els.saveButton.textContent = label;
  els.missedNotifyButton.textContent = label;
}

function updatePlateAgeLabels() {
  document.querySelectorAll(".dish-card").forEach((node) => {
    const dish = state.dishes.find((item) => item.id === node.dataset.id);
    const target = node.querySelector(".plate-age");
    if (dish && target) target.textContent = plateAgeLabel(dish);
  });
  const selected = selectedDish();
  const ticketAge = els.ticket.querySelector('[data-metric="ticket-age"] strong');
  if (selected && ticketAge) ticketAge.textContent = plateAgeLabel(selected);
}

function notificationActionForLabel(label) {
  if (label === "Notifications on") return "ready";
  if (label === "Notification settings") return "settings";
  if (label === "Check notifications") return "check";
  return "add";
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
  if (await syncNotificationDetailsFromHost(client?.notificationDetails, { silent })) return true;

  if (client?.added) {
    setNotificationUi("Notification settings", "settings");
    if (!silent) {
      els.serviceStatus.textContent = "App saved";
    }
    return false;
  }

  setNotificationUi("Turn on notifications");
  return false;
}

async function syncNotificationDetailsFromHost(notificationDetails, { silent = false } = {}) {
  if (!notificationDetails?.token || !notificationDetails?.url) return false;
  const stored = await syncNotificationDetails(notificationDetails);
  if (!stored) {
    setNotificationUi("Notification settings", "settings");
    if (!silent) {
      els.serviceStatus.textContent = "Notification save failed";
      els.tipStatus.textContent = "Farcaster sent a notification token, but Rektaurant could not save it. Try again in a minute.";
    }
    return false;
  }

  setNotificationUi("Notifications on", "ready");
  els.serviceStatus.textContent = "Notifications ready";
  if (!silent) {
    els.tipStatus.textContent = "Notifications are on. The kitchen can call you back when hot long/short dishes land.";
  }
  return true;
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

function isNativeToken(token) {
  return Boolean(token?.native) || /\/(?:native|slip44:60)$/i.test(String(token?.caip19 || ""));
}

function isMiniPayProvider(provider) {
  return Boolean(provider?.isMiniPay);
}

function bigintToHex(value) {
  const amount = BigInt(String(value || "0"));
  if (amount <= 0n) throw new Error("Payment amount unavailable");
  return `0x${amount.toString(16)}`;
}

function encodeErc20Transfer(recipientAddress, amount) {
  const recipient = String(recipientAddress || "").replace(/^0x/i, "").padStart(64, "0");
  const value = BigInt(String(amount || "0")).toString(16).padStart(64, "0");
  return `0xa9059cbb${recipient}${value}`;
}

function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function ticketMetric(label, value, metric = "") {
  const metricAttr = metric ? ` data-metric="${escapeHtml(metric)}"` : "";
  return `<span${metricAttr}><small>${label}</small><strong>${value}</strong></span>`;
}

function scoreRow(label, value) {
  const width = Math.max(4, Math.min(100, Number(value) || 0));
  return `<div class="score-row"><span>${label}</span><div><i style="width:${width}%"></i></div><strong>${value}</strong></div>`;
}

function isMissedDish(dish) {
  const lifecycle = String(dish?.lifecycle || "").toUpperCase();
  const recommendation = String(dish?.recommendation || "").toUpperCase();
  return ["RESOLVED", "EXPIRED", "CANCELLED", "CANCELED"].includes(lifecycle) || recommendation === "REVIEW_RESOLVED";
}

function plateAgeLabel(dish) {
  const servedAt = Date.parse(String(dish?.servedAt || ""));
  const fallbackSeconds = Number(dish?.plateAgeSeconds);
  const seconds = Number.isFinite(servedAt)
    ? Math.max(0, Math.round((Date.now() - servedAt) / 1000))
    : Number.isFinite(fallbackSeconds)
      ? Math.max(0, Math.round(fallbackSeconds))
      : null;
  if (seconds === null) return "Plate age unavailable";
  const prefix = isMissedDish(dish) ? "Missed" : "Served";
  return `${prefix} ${formatDurationAgo(seconds)} ago`;
}

function formatDurationAgo(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function sourceLabel(source) {
  if (source === "mcc") return "MCC";
  if (source === "mcc-v2-premium") return "MCC v2";
  if (source === "mcc-legacy-premium") return "MCC legacy";
  if (source === "mcc-unavailable") return "MCC unavailable";
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
