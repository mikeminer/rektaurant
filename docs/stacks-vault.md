# Rektaurant Stacks Vault

Rektaurant includes a simple Clarity vault contract for the Stacks Builder Rewards flow.

Contract:

```txt
contracts/rektaurant-vault.clar
```

What it does:

- accepts STX deposits through `deposit(amount, memo)`
- records each deposit sender, amount, memo and block height
- exposes `get-vault-balance`, `get-deposit`, `get-next-deposit-id` and `get-owner`
- lets only the deployer withdraw with `withdraw(amount, recipient)`

## Deploy

Install Clarinet, then run:

```powershell
clarinet check
clarinet deployments generate --testnet
clarinet deployments apply --testnet
```

For the contest, deploy on mainnet if Talent requires a mainnet contract:

```powershell
clarinet deployments generate --mainnet
clarinet deployments apply --mainnet
```

After deployment, copy the full contract id:

```txt
SP...YOURADDRESS.rektaurant-vault
```

## Enable in Vercel

Set this environment variable in the Vercel project:

```txt
REKTAURANT_STACKS_CONTRACT_ID=SP...YOURADDRESS.rektaurant-vault
```

Optional variables:

```txt
REKTAURANT_STACKS_NETWORK=mainnet
REKTAURANT_STACKS_VAULT_AMOUNT_USTX=100000
REKTAURANT_STACKS_VAULT_AMOUNT_LABEL=0.1 STX
```

Redeploy Rektaurant after setting the env vars. The Stacks vault button stays disabled until `REKTAURANT_STACKS_CONTRACT_ID` is set.
