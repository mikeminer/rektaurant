# Rektaurant Implementation

Rektaurant is a Farcaster Mini App powered by Multi Crypto Compare API signals.

It turns MCC Hyperliquid long and short setups into a restaurant-style menu:

- coin as a dish
- direction
- setup score
- entry context
- target
- invalidation
- confidence
- risk notes

When MCC is offline, Rektaurant should not ask users to pay or enter. It should show that the kitchen is closed.

## Relay Contract

Rektaurant reads MCC from:

```text
MCC_API_BASE
```

The MCC SaaS relay updates that Vercel env var with the latest Cloudflare Quick Tunnel URL pointing to MCC local API on port `3000`.

## Run

From `C:\Users\mikfo\Documents\New project 4`:

```powershell
.\scripts\mcc-implementation-relay.ps1 -Implementation rektaurant
```

What happens:

1. Starts MCC from `C:\Users\mikfo\Documents\New project 2`.
2. Waits for `http://127.0.0.1:3000/api/health`.
3. Opens a Cloudflare Quick Tunnel to MCC.
4. Updates Vercel env `MCC_API_BASE` in this Rektaurant project.
5. Redeploys production because `autoDeploy` is true.
6. Keeps the tunnel process alive.

## Links

- Live app: https://rektaurant.vercel.app/
- Source: https://github.com/mikeminer/rektaurant
- Devfolio: https://devfolio.co/projects/rektaurant-f632
- Talent: https://talent.app/~/projects/d6b75ece-1e07-4557-a9a1-039dedc834c6

Rektaurant serves hot Multi Crypto Compare signals, plated for Farcaster.
