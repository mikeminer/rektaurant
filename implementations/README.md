# MCC SaaS Implementations

This folder is the implementation registry for products powered by the Multi Crypto Compare API.

MCC is the core technology layer:

- local/API engine
- Hyperliquid signal intelligence
- portfolio and rebalance APIs
- SDK and developer tooling

Each implementation gets its own folder with the details needed to connect MCC to a consumer product, update the right Vercel project and keep deployment repeatable.

## Current Layout

```text
implementations/
  rektaurant/
    implementation.json
    README.md
    env.example
```

## Add A New Implementation

1. Create a new folder:

```text
implementations/my-new-app/
```

2. Add `implementation.json`:

```json
{
  "name": "my-new-app",
  "description": "Consumer app powered by MCC APIs",
  "mccProjectDir": "C:\\Users\\mikfo\\Documents\\New project 2",
  "mccStartBat": "start_mcc_site.bat",
  "mccStartArgs": "--no-cloudflare --no-sdk-ide",
  "mccPort": 3000,
  "mccHealthPath": "/api/health",
  "vercelProjectDir": "C:\\path\\to\\consumer-app",
  "vercelEnvName": "MCC_API_BASE",
  "vercelEnvironment": "production",
  "autoDeploy": true
}
```

3. Run the relay:

```powershell
.\scripts\mcc-implementation-relay.ps1 -Implementation my-new-app
```

The relay starts MCC, opens a Cloudflare Quick Tunnel to MCC, writes the tunnel URL into the implementation Vercel env var and redeploys if `autoDeploy` is true.

Do not store private keys, Vercel tokens, wallet secrets or Farcaster secrets in implementation folders.
