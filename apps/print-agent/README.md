# Print Agent

Sends production labels to the LabelCreate 2410BT from an always-on shop PC.

The API runs on Cloudflare Workers and cannot reach into the shop LAN, so this
agent polls it. That is also why an iPad can print at all: iOS has no Web
Bluetooth, so the browser there queues a job and this process does the printing.

## Setup

1. Install the printer driver from `pm2410.labelife.cc`. Install over **USB
   first** — it is the more reliable path even when Bluetooth is the goal — then
   switch the port to Bluetooth once the printer appears in the Windows printer
   list.
2. Run a gap calibration with the 3" x 1.5" stock loaded before trusting output.
3. Find the target:
   - **Bluetooth/serial:** Device Manager → Ports (COM & LPT) → the outgoing
     `COM<n>` for the paired printer.
   - **Shared printer:** share it in printer properties and use
     `\\localhost\<share name>`.
4. Set the Worker secret so the two sides agree:
   ```
   wrangler secret put PRINT_AGENT_SECRET
   ```
5. Install dependencies from the repo root (this workspace has no dependencies
   of its own, but `pnpm` needs to link the monorepo first):
   ```
   pnpm install
   ```
6. Set the environment variables from the [Environment](#environment) table
   below — `API_BASE_URL`, `PRINT_AGENT_SECRET`, and `PRINTER_TARGET` are all
   required, or `loadConfig` throws at startup naming whatever is missing.
   Set them as **system** environment variables so both an interactive run
   and the scheduled task in [Running at logon](#running-at-logon) inherit
   them without further setup.
7. Build and run:
   ```
   pnpm --filter print-agent build
   pnpm --filter print-agent start
   ```

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `API_BASE_URL` | yes | Worker origin, no trailing path — `https://blinds-nisa-api.blindsnisa.workers.dev` |
| `PRINT_AGENT_SECRET` | yes | Must match the Worker secret exactly |
| `PRINTER_TARGET` | yes | `COM5`, or a share like `\\localhost\LabelCreate` |
| `POLL_MS` | no | Poll interval, default `30000`, minimum `1000` |

## Running at logon

Register a Windows scheduled task that runs at logon with the working directory
set to the repo root:

```
schtasks /create /tn "Blinds Nisa Print Agent" /tr "node C:\path\to\repo\apps\print-agent\dist\index.js" /sc onlogon
```

This relies on the environment variables already having been set as **system**
variables in [Setup](#setup) above, so the task inherits them.

## If nothing prints

- The agent logs every poll failure with a timestamp — check its output first.
- A job stuck in `printing` for over 5 minutes is re-queued automatically, and
  fails for good after 3 attempts. Query `print_jobs` to see `last_error`.
- If the printer is silent but the agent reports success, the firmware may not
  speak TSPL. Confirm the model's command language before debugging further.
