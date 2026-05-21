# Rektaurant

Mini app Farcaster a tema ristorante per servire segnali Hyperliquid come piatti: coin, lato long/short, entry, target, invalidation, punteggi e note di rischio.

## Hiro Platform / Stacks

Il repository e pronto per essere importato in Hiro Platform da:

```text
https://platform.hiro.so/git-projects/new
```

Project GitHub:

```text
https://github.com/mikeminer/rektaurant
```

Il progetto Stacks e nella root del repository:

```text
Clarinet.toml
contracts/rektaurant-vault.clar
```

Contract name:

```text
rektaurant-vault
```

Se non lo vedi nella lista di Hiro, apri la configurazione GitHub dell'app Hiro e concedi accesso al repository `mikeminer/rektaurant`. Dopo l'import puoi deployare il contratto da Hiro e copiare il contract id in Vercel:

```text
REKTAURANT_STACKS_CONTRACT_ID=SP...YOURADDRESS.rektaurant-vault
```

## MCC SaaS implementation model

Questo progetto e anche il primo consumer implementation del sistema MCC SaaS:

```text
Multi Crypto Compare
= tecnologia principale, API, segnali, portfolio/rebalance intelligence
= gira localmente da C:\Users\mikfo\Documents\New project 2

MCC SDK IDE
= ambiente di sviluppo per script, bot e integrazioni API

Rektaurant
= consumer/Farcaster Mini App
= legge MCC_API_BASE da Vercel
= riceve automaticamente il tunnel MCC aggiornato
```

Per scalare, ogni nuova app che usa le API MCC deve avere una cartella dedicata in:

```text
implementations/
```

La prima e:

```text
implementations/rektaurant/
  implementation.json
  README.md
  env.example
```

Per avviare il relay automatico MCC -> Cloudflare Tunnel -> Vercel env -> deploy:

```powershell
.\scripts\mcc-implementation-relay.ps1 -Implementation rektaurant
```

Oppure da CMD/doppio click:

```cmd
manage_mcc_implementation.bat
```

Quando creerai una nuova implementation, crea una nuova cartella sotto `implementations/`, copia `implementation.json`, cambia `vercelProjectDir`, `vercelEnvName`, nome progetto e policy `autoDeploy`. Non mettere token, private key o segreti dentro queste cartelle.

## Avvio locale

```powershell
npm run make:assets
npm start
```

Poi apri `http://localhost:5173`.

Su Windows puoi anche avviare tutto con:

```powershell
.\start_rektaurant.bat
```

Non aprire `public/index.html` direttamente se vuoi usarla come mini app completa: Farcaster, manifest e API funzionano correttamente via server locale. Il file diretto ora carica comunque grafica e prova a usare `http://localhost:5173/api/menu`, ma il server deve essere acceso.

La app usa come default:

```text
MCC_API_BASE=https://important-bullet-sam-affiliates.trycloudflare.com
```

In questo ambiente Node non valida sempre la catena TLS dei tunnel Cloudflare. Il server locale quindi usa TLS permissivo di default; in produzione puoi forzare la verifica con:

```powershell
$env:REKTAURANT_STRICT_TLS="true"
```

## URL API da backend Vercel

In produzione l'URL MCC va configurato dal backend di Vercel, non dai browser degli utenti:

```text
MCC_API_BASE=https://il-tuo-tunnel.trycloudflare.com
```

Quando cambi tunnel perche il Rektaurant fisico era spento, aggiorna `MCC_API_BASE` nelle variabili ambiente del progetto Vercel e redeploya. La mini app leggerà `/api/config` dal backend e usera quel valore.

Il deploy Vercel usa `api/[...path].js` come funzione serverless e `vercel.json` per servire dinamicamente la homepage e `/.well-known/farcaster.json`, cosi i meta tag Farcaster e la config backend usano sempre il dominio reale.

Modo rapido da questo progetto:

```powershell
.\scripts\update-vercel-api-url.ps1 https://nuovo-tunnel.trycloudflare.com
```

Lo script aggiorna `MCC_API_BASE` in produzione e fa subito redeploy.

Da CMD o doppio click puoi usare anche:

```cmd
update_rektaurant_api_url.bat
```

Ti chiedera di incollare la nuova URL, per esempio `https://waiver-heath-merely-plane.trycloudflare.com/`.

Su Vercel l'override da UI e spento di default. Se vuoi riabilitarlo volutamente:

```text
REKTAURANT_ALLOW_CLIENT_API_OVERRIDE=true
```

In locale, invece, l'override da UI resta acceso per comodita:

il valore viene salvato nel browser con `localStorage`, quindi quando riapri la mini app usa l'ultimo tunnel inserito.

Prima della tip viene fatto un health check su `/api/health` della MCC API. Se non risponde, la app non mostra il pagamento: appare il cartello `Rektaurant is closed`. In produzione il cartello usa il valore Vercel di `MCC_API_BASE`; in locale puoi incollare un tunnel nuovo dalla UI.

Puoi cambiarlo cosi:

```powershell
$env:MCC_API_BASE="https://important-bullet-sam-affiliates.trycloudflare.com"
npm start
```

## Farcaster

Rektaurant include:

- meta tag `fc:miniapp` e `fc:frame`
- manifest dinamico su `/.well-known/farcaster.json`
- chiamata `sdk.actions.ready()`
- azioni `sendToken`, `composeCast` e `addMiniApp` quando aperta dentro Farcaster
- tip gate: 0.50/1/3 USDC su Base verso `pappardelle.eth`, poi sessione locale di 10 minuti
- wallet gate: bottone `Connect wallet` piu tip USDC su Base, con fallback al wallet nativo Farcaster mobile
- notifiche Farcaster tramite `webhookUrl`, token salvati su Redis/KV e script per inviare `open`, `closed`, `closing`, `happy-hour`
- proxy same-origin `/api/menu`, cosi il client non dipende da CORS esterni

## Notifiche Farcaster

Il manifest espone:

```text
https://rektaurant.vercel.app/api/webhook
```

Per notifiche persistenti in produzione collega un database Redis/KV al progetto Vercel e imposta queste env:

```text
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
REKTAURANT_NOTIFY_SECRET=...
```

Se hai usato il prefisso `UPSTASH_REDIS` nel Marketplace Vercel, vanno bene anche le env create come `UPSTASH_REDIS_KV_REST_API_URL` e `UPSTASH_REDIS_KV_REST_API_TOKEN`.

Poi gli utenti devono salvare la mini app in Farcaster: il webhook ricevera i token. Per inviare una notifica:

```powershell
.\scripts\send-rektaurant-notification.ps1 open
.\scripts\send-rektaurant-notification.ps1 closed
.\scripts\send-rektaurant-notification.ps1 closing
.\scripts\send-rektaurant-notification.ps1 happy-hour
```

Per vedere esempi casuali senza inviarli:

```powershell
.\scripts\send-rektaurant-notification.ps1 preview
```

Da CMD/doppio click puoi usare:

```cmd
send_rektaurant_notification.bat
```

Per pubblicarla, deploya su un dominio stabile HTTPS e genera l'`accountAssociation` dal Farcaster Developer Tool per quel dominio esatto. Poi passa l'oggetto firmato come variabile:

```powershell
$env:REKTAURANT_ACCOUNT_ASSOCIATION='{"header":"...","payload":"...","signature":"..."}'
```

Nota: Rektaurant e MCC sono read-only. Non inviano ordini, firme, approvazioni o transazioni.

La tip usa `REKTAURANT_TIP_ADDRESS` se vuoi sovrascrivere il destinatario; il default e `pappardelle.eth` risolto come `0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134`. In produzione conviene verificare server-side le transazioni se vuoi un paywall non aggirabile da devtools.
