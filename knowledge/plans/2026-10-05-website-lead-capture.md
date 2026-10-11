# Website Lead Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Forminator "Free Estimate" form on blindsnisa.com with an embeddable form whose submissions land in a new **Leads** page in the staff app. Each new lead also sends one SMS to a fixed number and one email to the shop inbox.

**Architecture:** The WordPress page gets a two-line embed (`<div>` + `<script>`). The script is served from the existing `measure-blinds` web Worker (`apps/web/public/embed/lead-form.js`). It renders the form inside a Shadow DOM so Elementor's CSS cannot affect it, and it POSTs JSON to a new **unauthenticated, rate-limited, Turnstile-protected** API route, `POST /intake/lead`, on `blinds-nisa-api`. That route validates with a strict Zod schema, inserts into a new `leads` table (migration 44) and then calls Twilio (SMS) and Resend (email) in `waitUntil`. Both alerts are best effort: a lead is never lost because an alert failed, and the visitor never waits on Twilio. Staff see leads at `/leads` (list, status filter, detail, status change) through the authenticated endpoints `GET /api/leads` and `PATCH /api/leads/:id`.

**Tech Stack:** Hono 4 on Cloudflare Workers, Zod 3, supabase-js 2 (service role), Resend (existing `sendEmail`), Twilio Programmable Messaging REST API (plain `fetch`, no SDK), Cloudflare Turnstile, React 19 + TanStack Query 5 + Tailwind 4, plain browser JS for the embed.

## Global Constraints

- Every new `.ts`/`.tsx`/`.sql`/`.js` file starts with the SPDX header (AI_GUIDELINES §10). SQL uses `--`.
- Every exported symbol gets a JSDoc of 8/10 or better (AI_GUIDELINES §3).
- Zod request schemas are `.strict()`. Unknown fields are rejected with a 400, not stripped.
- All user-supplied strings that go into email HTML pass through `escapeHtml` (`apps/api/src/lib/email.ts:26`).
- Service-role key, Twilio auth token and Turnstile secret exist only as Worker secrets. They never go in `apps/web` or a committed file.
- No anon RLS policy on `leads`. The public write goes only through the Worker.
- **Persist-then-alert** (deliberately the reverse of the estimate's email-then-persist rule): the lead row is the thing that must not be lost, and the alerts only announce it.
- The intake route is **NOT** mounted under `/public`. That group's maintenance gate (`routes/public.ts:108`) would 503 new leads whenever staff put customer pages into maintenance.
- Files stay under 800 lines. Entry points stay thin. `index.ts` only mounts routes.
- Verification: `pnpm check`, `pnpm test`, `pnpm lint` (web) in each touched workspace. Target 0/0.
- At the end, update `knowledge/history/engine_features.md` and `memory-bank/activeContext.md` + `progress.md` (as current-state summaries).

## Decisions to confirm before Task 1

| # | Decision | Default in this plan |
|---|----------|----------------------|
| D1 | SMS provider | **Twilio**: a Canadian long-code number (~US$1.15/mo + ~$0.008/SMS). A Canadian number avoids US 10DLC registration. GC Notify (notification.canada.ca) was checked and ruled out (2026-10-05): its terms require a valid government email to open an account, so it is for government services only. |
| D2 | Where the alert phone number lives | `LEAD_SMS_TO` in `apps/api/wrangler.toml` `[vars]`, e.g. `"+16135550123"`. It is "in the code" (committed) but changes without touching TypeScript. |
| D3 | Alert email recipient | `company_settings.email` (same as the confirm/cancel notices). Optional `LEAD_NOTIFY_EMAIL` var overrides it. |
| D4 | Bot protection | Cloudflare Turnstile (free, invisible "managed" mode) **plus** a honeypot field. Without it, bots posting the form would cost real money in SMS. |
| D5 | Form fields | Same as today: Name\*, Email\*, Phone, Street, Apt/Suite, City, Province, Postal code, Message (≤180 → raised to 1000), Consent\* checkbox with the existing wording. Bilingual labels kept. |
| D6 | Mode of delivery | Hosted script (update once, every page picks it up) rather than pasting the whole form into Elementor. |

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20261005000044_leads.sql` | **Create.** `leads` table, status check, indexes, RLS. |
| `apps/api/src/lib/leadSchema.ts` | **Create.** Zod schema + `LeadInput` type for the public form payload. |
| `apps/api/src/lib/turnstile.ts` | **Create.** `verifyTurnstile(secret, token, ip)` → boolean via siteverify. |
| `apps/api/src/lib/sms.ts` | **Create.** `sendSms(env, to, body)` via the Twilio REST API. Throws on non-2xx. |
| `apps/api/src/lib/leadAlerts.ts` | **Create.** `buildLeadSmsText`, `buildLeadEmailHtml`, `sendLeadAlerts` (best effort, never throws). |
| `apps/api/src/routes/leadIntake.ts` | **Create.** `POST /lead`, public, mounted at `/intake`. |
| `apps/api/src/routes/leads.ts` | **Create.** `GET /`, `PATCH /:id`, authenticated, mounted at `/api/leads`. |
| `apps/api/src/index.ts` | **Modify.** `Env` additions, CORS origins, two `app.route` lines. |
| `apps/api/wrangler.toml` | **Modify.** `LEAD_SMS_TO`, secrets comment block. |
| `apps/web/public/embed/lead-form.js` | **Create.** Self-contained embeddable form (Shadow DOM, Turnstile, fetch). |
| `apps/web/src/types/index.ts` | **Modify.** `Lead`, `LeadStatus`. |
| `apps/web/src/hooks/useLeads.ts` | **Create.** `useLeads(page, status)`, `useUpdateLeadStatus()`. |
| `apps/web/src/pages/leads/LeadsPage.tsx` | **Create.** List + filter chips + pager. |
| `apps/web/src/pages/leads/LeadRow.tsx` | **Create.** One expandable lead card with contact links + status buttons. |
| `apps/web/src/pages/leads/leadText.ts` (+ `.test.ts`) | **Create.** Pure formatting helpers (address line, status labels). |
| `apps/web/src/App.tsx`, `components/Sidebar.tsx` | **Modify.** Route + nav item. |

---

### Task 1: `leads` table (migration 44)

**Files:**
- Create: `supabase/migrations/20261005000044_leads.sql`

**Interfaces:**
- Produces: table `public.leads` with columns used by all later tasks: `id uuid`, `status text ('new'|'contacted'|'converted'|'archived')`, `name`, `email`, `phone`, `street`, `unit`, `city`, `province`, `postal_code`, `message` (all `text not null default ''` except name/email), `consent boolean`, `source_url text`, `customer_id uuid null`, `sms_sent_at timestamptz null`, `email_sent_at timestamptz null`, `created_at`, `updated_at`.

- [ ] **Step 1: Write the migration**

```sql
-- SPDX-License-Identifier: GPL-3.0-only
-- Copyright (c) 2026 Blinds Nisa. All rights reserved.
--
-- Migration 44: website leads.
--
-- The "Free Estimate" form on blindsnisa.com posts to the Worker's public
-- `POST /intake/lead`; each submission becomes one row here. Staff work
-- them on the Leads page: new → contacted → converted (became a customer)
-- or archived (spam, not a fit, duplicate).
--
-- `sms_sent_at` / `email_sent_at` record whether the best-effort alerts
-- for this lead actually went out, so a silent Twilio/Resend failure is
-- visible on the row instead of only in Worker logs.
--
-- `customer_id` is reserved for the later "Convert to customer" action;
-- SET NULL so deleting a customer never deletes the lead that produced it.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'converted', 'archived')),

  name text not null,
  email text not null,
  phone text not null default '',
  street text not null default '',
  unit text not null default '',
  city text not null default '',
  province text not null default '',
  postal_code text not null default '',
  message text not null default '',
  consent boolean not null default false,

  -- Page the form was embedded on, for when the form lives on several pages.
  source_url text not null default '',

  customer_id uuid references public.customers (id) on delete set null,

  sms_sent_at timestamptz,
  email_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leads page: newest first, optionally filtered by status.
create index leads_status_created_idx on public.leads (status, created_at desc);
create index leads_created_idx on public.leads (created_at desc);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

-- Single-org model: authenticated staff full access, service role bypasses
-- RLS, anon gets nothing (the public form writes through the Worker only).
create policy authenticated_full_access on public.leads
  for all to authenticated
  using (true) with check (true);
```

- [ ] **Step 2: Confirm the `set_updated_at` helper name**

Run: `grep -n "function public\." supabase/migrations/20260703000000_init_helpers.sql`
Expected: the updated-at trigger function. If its name differs from `set_updated_at`, use the real name in the trigger above.

- [ ] **Step 3: Apply to the live project**

Apply with the Supabase MCP `apply_migration` (project `lgbxxlwsdeuhdgzrjjen`, name `leads`). Then run `list_tables` and confirm `leads` exists with RLS enabled. Run `get_advisors` (security) and confirm there is no new warning for `leads`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261005000044_leads.sql
git commit -m "feat(db): leads table for website form submissions"
```

---

### Task 2: Lead payload schema

**Files:**
- Create: `apps/api/src/lib/leadSchema.ts`
- Test: `apps/api/src/lib/leadSchema.test.ts`

**Interfaces:**
- Produces: `leadInputSchema` (Zod) and `type LeadInput = z.infer<typeof leadInputSchema>` with keys `name, email, phone, street, unit, city, province, postal_code, message, consent (literal true), source_url, turnstile_token, website (honeypot, must be '')`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins the public lead form contract: required name/email/consent,
 * trimming, length caps, strict rejection of unknown keys, and the
 * honeypot that must arrive empty.
 */
import { describe, it, expect } from 'vitest';
import { leadInputSchema } from './leadSchema';

const valid = {
  name: '  Jane Doe ',
  email: 'jane@example.com',
  phone: '613-555-0123',
  street: '42 Wallaby Way',
  unit: '',
  city: 'Ottawa',
  province: 'ON',
  postal_code: 'K1A 0B1',
  message: 'Roller shades for 6 windows',
  consent: true,
  source_url: 'https://blindsnisa.com/free-estimate/',
  turnstile_token: 'tok',
  website: '',
};

describe('leadInputSchema', () => {
  it('accepts a full submission and trims strings', () => {
    const r = leadInputSchema.parse(valid);
    expect(r.name).toBe('Jane Doe');
  });

  it('fills optional address/message fields with empty strings', () => {
    const r = leadInputSchema.parse({
      name: 'A', email: 'a@b.co', consent: true, turnstile_token: 't', website: '',
    });
    expect(r.phone).toBe('');
    expect(r.message).toBe('');
  });

  it('requires consent to be exactly true', () => {
    expect(leadInputSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it('rejects a bad email', () => {
    expect(leadInputSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    expect(leadInputSchema.safeParse({ ...valid, status: 'converted' }).success).toBe(false);
  });

  it('rejects a filled honeypot', () => {
    expect(leadInputSchema.safeParse({ ...valid, website: 'http://spam' }).success).toBe(false);
  });

  it('caps message length at 1000', () => {
    expect(leadInputSchema.safeParse({ ...valid, message: 'x'.repeat(1001) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && pnpm vitest run src/lib/leadSchema.test.ts`
Expected: FAIL, "Cannot find module './leadSchema'".

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Contract for the public website lead form (`POST /intake/lead`).
 *
 * The form is embedded on blindsnisa.com (WordPress) by
 * `apps/web/public/embed/lead-form.js`, which sends exactly these keys.
 * Strict so a crafted request cannot set server-owned columns such as
 * `status` or `customer_id`. Every text field is trimmed and capped, so
 * a bot cannot push megabytes into the row, the SMS or the email.
 * `website` is a honeypot: the field is visually hidden in the embed and
 * real visitors leave it empty.
 */
import { z } from 'zod';

/** Optional trimmed text with a cap; missing becomes ''. */
const text = (max: number) => z.string().trim().max(max).default('');

/** Validated shape of one website form submission. */
export const leadInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: text(40),
    street: text(200),
    unit: text(60),
    city: text(80),
    province: text(40),
    postal_code: text(12),
    message: text(1000),
    consent: z.literal(true),
    source_url: text(500),
    turnstile_token: z.string().min(1).max(2048),
    website: z.literal(''),
  })
  .strict();

/** Parsed, trimmed lead submission (Turnstile token and honeypot included). */
export type LeadInput = z.infer<typeof leadInputSchema>;
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/api && pnpm vitest run src/lib/leadSchema.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/leadSchema.ts apps/api/src/lib/leadSchema.test.ts
git commit -m "feat(api): strict schema for website lead submissions"
```

---

### Task 3: Turnstile verification + Twilio SMS clients

**Files:**
- Create: `apps/api/src/lib/turnstile.ts`, `apps/api/src/lib/sms.ts`
- Test: `apps/api/src/lib/turnstile.test.ts`, `apps/api/src/lib/sms.test.ts`

**Interfaces:**
- Produces: `verifyTurnstile(secret: string, token: string, ip: string | undefined): Promise<boolean>`
- Produces: `interface SmsEnv { TWILIO_ACCOUNT_SID: string; TWILIO_AUTH_TOKEN: string; TWILIO_FROM: string }` and `sendSms(env: SmsEnv, to: string, body: string): Promise<void>` (throws `Error` with Twilio's message on non-2xx).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/lib/sms.test.ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Pins the Twilio request shape (Basic auth, form-encoded) and error surfacing. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendSms } from './sms';

const ENV = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: '+16135550000' };

afterEach(() => vi.unstubAllGlobals());

describe('sendSms', () => {
  it('posts form-encoded To/From/Body with Basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendSms(ENV, '+16135550123', 'Hi');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${btoa('AC123:secret')}`);
    const body = new URLSearchParams(init.body);
    expect(body.get('To')).toBe('+16135550123');
    expect(body.get('From')).toBe('+16135550000');
    expect(body.get('Body')).toBe('Hi');
  });

  it("throws with Twilio's message on failure", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid To' }), { status: 400 })
    ));
    await expect(sendSms(ENV, 'x', 'y')).rejects.toThrow('Invalid To');
  });
});
```

```ts
// apps/api/src/lib/turnstile.test.ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/** Pins siteverify usage and fail-closed behaviour. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyTurnstile } from './turnstile';

afterEach(() => vi.unstubAllGlobals());

describe('verifyTurnstile', () => {
  it('returns true when siteverify says success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await verifyTurnstile('s', 't', '1.2.3.4')).toBe(true);
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('secret')).toBe('s');
    expect(body.get('response')).toBe('t');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('returns false on success:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false })));
    expect(await verifyTurnstile('s', 't', undefined)).toBe(false);
  });

  it('fails closed when siteverify is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await verifyTurnstile('s', 't', undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd apps/api && pnpm vitest run src/lib/sms.test.ts src/lib/turnstile.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/lib/sms.ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Outbound SMS through Twilio's Programmable Messaging REST API.
 *
 * Plain `fetch` rather than the `twilio` npm SDK, which depends on Node
 * built-ins that workerd does not provide. Used today only for the
 * staff "new website lead" alert (`lib/leadAlerts.ts`), so it sends to
 * a number the business controls. Customer-facing SMS would need
 * consent tracking and STOP handling before reusing it.
 */

/** Twilio credentials, all Worker secrets (`wrangler secret put`). */
export interface SmsEnv {
  /** Account SID, "AC…". */
  TWILIO_ACCOUNT_SID: string;
  /** Auth token. Never committed, never sent to the browser. */
  TWILIO_AUTH_TOKEN: string;
  /** The Twilio number SMS is sent from, E.164 (e.g. "+16135550000"). */
  TWILIO_FROM: string;
}

/**
 * Sends one SMS.
 *
 * @param to - Destination in E.164 format
 * @param body - Message text; keep it under 160 GSM chars to stay one segment
 * @throws Error carrying Twilio's message when the API responds non-2xx
 */
export async function sendSms(env: SmsEnv, to: string, body: string): Promise<void> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }).toString(),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? `SMS service error (${res.status})`);
  }
}
```

```ts
// apps/api/src/lib/turnstile.ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Server-side Cloudflare Turnstile check for public forms.
 *
 * The website lead form renders the Turnstile widget and sends its token.
 * Without a pass, the intake route stores nothing and sends no SMS, so
 * bots cannot run up Twilio charges. Fails CLOSED: if siteverify is
 * unreachable the submission is refused, and the embed tells the visitor
 * to try again or call.
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies a Turnstile token against Cloudflare.
 *
 * @param secret - TURNSTILE_SECRET Worker secret
 * @param token - `cf-turnstile-response` value from the browser
 * @param ip - Visitor IP (CF-Connecting-IP), optional extra signal
 * @returns true only on an explicit `success: true`
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | undefined
): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error('Turnstile siteverify failed:', e);
    return false;
  }
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd apps/api && pnpm vitest run src/lib/sms.test.ts src/lib/turnstile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/sms.ts apps/api/src/lib/sms.test.ts apps/api/src/lib/turnstile.ts apps/api/src/lib/turnstile.test.ts
git commit -m "feat(api): Twilio SMS client and Turnstile verifier"
```

---

### Task 4: Lead alerts (SMS text, email HTML, best-effort sender)

**Files:**
- Create: `apps/api/src/lib/leadAlerts.ts`
- Test: `apps/api/src/lib/leadAlerts.test.ts`

**Interfaces:**
- Consumes: `sendSms`, `SmsEnv` (Task 3); `sendEmail`, `escapeHtml`, `brandedShell`, `headingHtml`, `brandFromSettings` (`lib/email.ts`); `createSupabaseAdmin` (`lib/supabase.ts`).
- Produces:
  - `interface LeadAlertRow { id: string; name: string; email: string; phone: string; street: string; unit: string; city: string; province: string; postal_code: string; message: string; source_url: string }`
  - `buildLeadSmsText(lead: LeadAlertRow, appUrl: string): string`
  - `buildLeadEmailHtml(lead: LeadAlertRow, appUrl: string): string` (inner body; wrapped by the caller)
  - `sendLeadAlerts(env: Env, lead: LeadAlertRow): Promise<void>` (never throws; stamps `sms_sent_at` / `email_sent_at`)

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins lead alert content (SMS stays short and plain, email escapes every
 * visitor-supplied string) and the best-effort contract of sendLeadAlerts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent = { sms: [] as string[], email: [] as string[], updates: [] as Record<string, unknown>[] };
let smsFails = false;

vi.mock('./sms', () => ({
  sendSms: vi.fn(async (_e: unknown, _to: string, body: string) => {
    if (smsFails) throw new Error('twilio down');
    sent.sms.push(body);
  }),
}));
vi.mock('./email', async (orig) => ({
  ...(await orig<typeof import('./email')>()),
  sendEmail: vi.fn(async (_e: unknown, req: { html: string }) => { sent.email.push(req.html); }),
}));
vi.mock('./supabase', () => ({
  createSupabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.single = async () => ({ data: { email: 'shop@blindsnisa.com', company_name: 'Blinds Nisa' }, error: null });
      b.update = (v: Record<string, unknown>) => { sent.updates.push(v); return b; };
      (b as { then: unknown }).then = (f: (v: unknown) => unknown) => Promise.resolve(f({ error: null }));
      return b;
    },
  }),
}));

import { buildLeadSmsText, buildLeadEmailHtml, sendLeadAlerts, type LeadAlertRow } from './leadAlerts';

const lead: LeadAlertRow = {
  id: 'L1', name: 'Jane <b>Doe</b>', email: 'jane@example.com', phone: '613-555-0123',
  street: '42 Wallaby Way', unit: '', city: 'Ottawa', province: 'ON', postal_code: 'K1A 0B1',
  message: 'Roller shades, 6 windows', source_url: 'https://blindsnisa.com/free-estimate/',
};
const ENV = {
  SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', RESEND_API_KEY: 'x',
  APP_URL: 'https://app.example', ENVIRONMENT: 'test',
  TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+1', LEAD_SMS_TO: '+16135550123',
  TURNSTILE_SECRET: 's',
};

beforeEach(() => { sent.sms = []; sent.email = []; sent.updates = []; smsFails = false; });

describe('buildLeadSmsText', () => {
  it('names the lead, phone, city and links to the Leads page', () => {
    const t = buildLeadSmsText(lead, 'https://app.example');
    expect(t).toContain('New lead');
    expect(t).toContain('613-555-0123');
    expect(t).toContain('Ottawa');
    expect(t).toContain('https://app.example/leads');
  });
});

describe('buildLeadEmailHtml', () => {
  it('escapes visitor-supplied strings', () => {
    const html = buildLeadEmailHtml(lead, 'https://app.example');
    expect(html).not.toContain('<b>Doe</b>');
    expect(html).toContain('&lt;b&gt;Doe&lt;/b&gt;');
  });
});

describe('sendLeadAlerts', () => {
  it('sends both and stamps both timestamps', async () => {
    await sendLeadAlerts(ENV, lead);
    expect(sent.sms).toHaveLength(1);
    expect(sent.email).toHaveLength(1);
    expect(sent.updates.some((u) => 'sms_sent_at' in u)).toBe(true);
    expect(sent.updates.some((u) => 'email_sent_at' in u)).toBe(true);
  });

  it('still emails when SMS fails, and never throws', async () => {
    smsFails = true;
    await expect(sendLeadAlerts(ENV, lead)).resolves.toBeUndefined();
    expect(sent.email).toHaveLength(1);
    expect(sent.updates.some((u) => 'sms_sent_at' in u)).toBe(false);
  });

  it('skips SMS when LEAD_SMS_TO is unset', async () => {
    await sendLeadAlerts({ ...ENV, LEAD_SMS_TO: '' }, lead);
    expect(sent.sms).toHaveLength(0);
    expect(sent.email).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && pnpm vitest run src/lib/leadAlerts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Before writing, read `brandFromSettings` / `brandedShell` in `lib/email.ts:119-200` and match the columns `brandFromSettings` needs in the `company_settings` select.

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff alerts for a new website lead: one SMS to `LEAD_SMS_TO` and one
 * email to the shop inbox (`LEAD_NOTIFY_EMAIL`, else
 * `company_settings.email`).
 *
 * Called from `routes/leadIntake.ts` inside `executionCtx.waitUntil`,
 * AFTER the lead row is inserted. Best effort by contract: each channel is
 * attempted independently, failures are logged and never thrown, and a
 * channel that succeeds stamps `leads.sms_sent_at` / `email_sent_at` so
 * the Leads page can show which alerts actually went out.
 */
import type { Env } from '../index';
import { createSupabaseAdmin } from './supabase';
import { sendSms } from './sms';
import { sendEmail, escapeHtml, brandedShell, brandFromSettings, headingHtml } from './email';

/** The lead columns the alerts render. Matches the `leads` row. */
export interface LeadAlertRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  street: string;
  unit: string;
  city: string;
  province: string;
  postal_code: string;
  message: string;
  source_url: string;
}

/** Joins the non-empty address parts into one line ("42 Wallaby Way, Ottawa, ON K1A 0B1"). */
function addressLine(l: LeadAlertRow): string {
  const street = [l.street, l.unit].filter(Boolean).join(' ');
  const region = [l.province, l.postal_code].filter(Boolean).join(' ');
  return [street, l.city, region].filter(Boolean).join(', ');
}

/**
 * Plain-text SMS. Kept short (name, phone, city, link) so it fits in one or
 * two segments. The full message is in the email and on the Leads page.
 */
export function buildLeadSmsText(l: LeadAlertRow, appUrl: string): string {
  const parts = [`New lead: ${l.name}`, l.phone || l.email, l.city].filter(Boolean);
  return `${parts.join(' · ')}\n${appUrl.replace(/\/$/, '')}/leads`;
}

/**
 * Email body (the caller wraps it in `brandedShell`). Every visitor string
 * goes through `escapeHtml` (AI_GUIDELINES §2).
 */
export function buildLeadEmailHtml(l: LeadAlertRow, appUrl: string): string {
  const row = (label: string, value: string) =>
    value
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
      : '';
  const link = `${appUrl.replace(/\/$/, '')}/leads`;
  return `${headingHtml('New website lead')}
<table style="border-collapse:collapse;font-size:14px">
${row('Name', l.name)}${row('Email', l.email)}${row('Phone', l.phone)}
${row('Address', addressLine(l))}${row('Message', l.message)}${row('Page', l.source_url)}
</table>
<p style="margin-top:16px"><a href="${escapeHtml(link)}">Open Leads</a></p>`;
}

/** Sends both alerts independently; never throws. See module header. */
export async function sendLeadAlerts(env: Env, lead: LeadAlertRow): Promise<void> {
  const sb = createSupabaseAdmin(env);

  const sms = (async () => {
    if (!env.LEAD_SMS_TO) return;
    try {
      await sendSms(env, env.LEAD_SMS_TO, buildLeadSmsText(lead, env.APP_URL));
      await sb.from('leads').update({ sms_sent_at: new Date().toISOString() }).eq('id', lead.id);
    } catch (e) {
      console.error(`Lead ${lead.id} SMS failed:`, e);
    }
  })();

  const email = (async () => {
    try {
      const { data: company } = await sb.from('company_settings').select('*').eq('id', 1).single();
      const to = env.LEAD_NOTIFY_EMAIL || company?.email;
      if (!to) return;
      await sendEmail(env, {
        to,
        subject: `New lead: ${lead.name}`,
        html: brandedShell(brandFromSettings(company), buildLeadEmailHtml(lead, env.APP_URL)),
        replyTo: lead.email, // pressing Reply answers the customer directly
      });
      await sb.from('leads').update({ email_sent_at: new Date().toISOString() }).eq('id', lead.id);
    } catch (e) {
      console.error(`Lead ${lead.id} email failed:`, e);
    }
  })();

  await Promise.all([sms, email]);
}
```

- [ ] **Step 4: Add the env bindings (needed for the code to compile)**

In `apps/api/src/index.ts`, extend `Env` (after `ETRANSFER_WEBHOOK_SECRET`):

```ts
  /** Twilio Account SID for staff SMS alerts (secret). */
  TWILIO_ACCOUNT_SID: string;
  /** Twilio auth token (secret). */
  TWILIO_AUTH_TOKEN: string;
  /** Twilio sending number, E.164 (secret). */
  TWILIO_FROM: string;
  /** Number that receives the "new website lead" SMS, E.164 ([vars]); '' disables SMS. */
  LEAD_SMS_TO: string;
  /** Overrides company_settings.email as the new-lead alert recipient. */
  LEAD_NOTIFY_EMAIL?: string;
  /** Cloudflare Turnstile secret for the public lead form (secret). */
  TURNSTILE_SECRET: string;
```

In `apps/api/wrangler.toml` `[vars]` add `LEAD_SMS_TO = "+1XXXXXXXXXX"`, using the real number the user gives (D2). Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TURNSTILE_SECRET` and optionally `LEAD_NOTIFY_EMAIL` to the secrets comment block. Add the same four secrets with test values to `apps/api/.dev.vars`, which is not committed.

- [ ] **Step 5: Run the tests and the type check**

Run: `cd apps/api && pnpm vitest run src/lib/leadAlerts.test.ts && pnpm check`
Expected: PASS (5 tests); tsc 0 errors. If other route tests build an `ENV` literal typed as `Env`, they now need the new keys. Fix them in this step.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/leadAlerts.ts apps/api/src/lib/leadAlerts.test.ts apps/api/src/index.ts apps/api/wrangler.toml
git commit -m "feat(api): SMS + email alerts for new website leads"
```

---

### Task 5: Public intake route `POST /intake/lead`

**Files:**
- Create: `apps/api/src/routes/leadIntake.ts`
- Test: `apps/api/src/routes/leadIntake.routes.test.ts`
- Modify: `apps/api/src/index.ts` (CORS origins + mount)

**Interfaces:**
- Consumes: `leadInputSchema` (T2), `verifyTurnstile` (T3), `sendLeadAlerts`, `LeadAlertRow` (T4), `rateLimit` (`middleware/rateLimit.ts`).
- Produces: `POST /intake/lead` → `201 { ok: true }` | `400 { error }` | `403 { error: 'verification_failed' }` | `429` | `500`.

- [ ] **Step 1: Write the failing route test**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Route tests for the public lead intake. Pins: validation (400), Turnstile
 * gate (403, nothing stored), insert of exactly the form columns (no token,
 * no honeypot), alerts dispatched via waitUntil AFTER the insert, and a
 * 500 that still never sends alerts for an unsaved lead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { inserted: [] as Record<string, unknown>[], insertError: null as null | { message: string } };
let turnstileOk = true;
const alerts: unknown[] = [];

vi.mock('../lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => turnstileOk) }));
vi.mock('../lib/leadAlerts', () => ({ sendLeadAlerts: vi.fn(async (_e: unknown, l: unknown) => { alerts.push(l); }) }));
vi.mock('../lib/supabase', () => ({
  createSupabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.insert = (row: Record<string, unknown>) => { db.inserted.push(row); return b; };
      b.select = () => b;
      b.single = async () =>
        db.insertError ? { data: null, error: db.insertError } : { data: { id: 'L1', ...db.inserted.at(-1) }, error: null };
      return b;
    },
  }),
}));

import intake from './leadIntake';

const ENV = {
  SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', RESEND_API_KEY: 'x', APP_URL: 'x', ENVIRONMENT: 'test',
  TWILIO_ACCOUNT_SID: 'x', TWILIO_AUTH_TOKEN: 'x', TWILIO_FROM: 'x', LEAD_SMS_TO: 'x', TURNSTILE_SECRET: 's',
};
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {}, props: {} };

const body = {
  name: 'Jane', email: 'jane@example.com', phone: '', street: '', unit: '', city: 'Ottawa',
  province: '', postal_code: '', message: 'hi', consent: true, source_url: 'https://blindsnisa.com/free-estimate/',
  turnstile_token: 'tok', website: '',
};
const post = (b: unknown, ip = '9.9.9.' + Math.random()) =>
  intake.request('/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(b),
  }, ENV, ctx as unknown as ExecutionContext);

beforeEach(() => { db.inserted = []; db.insertError = null; turnstileOk = true; alerts.length = 0; waits.length = 0; });

describe('POST /intake/lead', () => {
  it('stores the lead and schedules alerts', async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(db.inserted[0]).toMatchObject({ name: 'Jane', city: 'Ottawa', consent: true });
    expect(db.inserted[0]).not.toHaveProperty('turnstile_token');
    expect(db.inserted[0]).not.toHaveProperty('website');
    await Promise.all(waits);
    expect(alerts).toHaveLength(1);
  });

  it('400s invalid input without touching the DB', async () => {
    const res = await post({ ...body, email: 'bad' });
    expect(res.status).toBe(400);
    expect(db.inserted).toHaveLength(0);
  });

  it('403s a failed Turnstile check and stores nothing', async () => {
    turnstileOk = false;
    const res = await post(body);
    expect(res.status).toBe(403);
    expect(db.inserted).toHaveLength(0);
    expect(alerts).toHaveLength(0);
  });

  it('500s on insert failure and sends no alerts', async () => {
    db.insertError = { message: 'boom' };
    const res = await post(body);
    expect(res.status).toBe(500);
    expect(waits).toHaveLength(0);
  });

  it('rate-limits a single IP after 5 submissions per 10 minutes', async () => {
    for (let i = 0; i < 5; i++) await post(body, '1.1.1.1');
    expect((await post(body, '1.1.1.1')).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && pnpm vitest run src/routes/leadIntake.routes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the route**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Public website lead intake. Mounted at `/intake`, NO authentication.
 *
 *   POST /intake/lead   one "Free Estimate" form submission from blindsnisa.com
 *
 * Deliberately NOT part of the `/public` group: that group's maintenance
 * gate closes customer estimate pages, but new enquiries must keep
 * arriving while staff are mid-maintenance.
 *
 * Defences, in order: IP rate limit (5 per 10 min), strict Zod schema with
 * honeypot, Cloudflare Turnstile. Only then is the row inserted. Alerts
 * (SMS + email) run in `waitUntil` AFTER the insert succeeds, so the
 * visitor gets a fast 201, and a lead that failed to save never pages
 * anyone. CORS for the WordPress origin is configured globally in
 * `index.ts`.
 */
import { Hono } from 'hono';
import type { Env } from '../index';
import { createSupabaseAdmin } from '../lib/supabase';
import { rateLimit } from '../middleware/rateLimit';
import { leadInputSchema } from '../lib/leadSchema';
import { verifyTurnstile } from '../lib/turnstile';
import { sendLeadAlerts, type LeadAlertRow } from '../lib/leadAlerts';

const app = new Hono<{ Bindings: Env }>();

app.use('*', rateLimit(5, 10 * 60_000));

/** Accepts one lead. See module header for the ordering guarantees. */
app.post('/lead', async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = leadInputSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'Please check the form and try again.' }, 400);

  const { turnstile_token, website: _honeypot, ...lead } = parsed.data;
  const ok = await verifyTurnstile(
    c.env.TURNSTILE_SECRET,
    turnstile_token,
    c.req.header('CF-Connecting-IP')
  );
  if (!ok) return c.json({ error: 'verification_failed' }, 403);

  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb.from('leads').insert(lead).select('*').single();
  if (error || !data) {
    console.error('Lead insert failed:', error?.message);
    return c.json({ error: 'Something went wrong. Please call us instead.' }, 500);
  }

  c.executionCtx.waitUntil(sendLeadAlerts(c.env, data as LeadAlertRow));
  return c.json({ ok: true }, 201);
});

export default app;
```

- [ ] **Step 4: Mount it and open CORS to the website**

In `apps/api/src/index.ts`:
1. Import `leadIntakeRoutes from './routes/leadIntake'`.
2. Mount it next to `/webhooks`, above `app.use('/api/*', requireAuth)`, with a JSDoc line explaining why it sits outside `/public`:
   ```ts
   /** Website "Free Estimate" form — public, Turnstile + rate-limited, outside /public's maintenance gate. */
   app.route('/intake', leadIntakeRoutes);
   ```
3. In the CORS `origin` callback, also allow `https://blindsnisa.com` and `https://www.blindsnisa.com`. Use exact `===` comparisons, never `includes`.

- [ ] **Step 5: Run the tests and the type check**

Run: `cd apps/api && pnpm vitest run src/routes/leadIntake.routes.test.ts && pnpm check && pnpm test`
Expected: all PASS, 0 tsc errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/leadIntake.ts apps/api/src/routes/leadIntake.routes.test.ts apps/api/src/index.ts
git commit -m "feat(api): public POST /intake/lead with Turnstile and alerts"
```

---

### Task 6: Staff leads API `GET /api/leads`, `PATCH /api/leads/:id`

**Files:**
- Create: `apps/api/src/routes/leads.ts`
- Test: `apps/api/src/routes/leads.routes.test.ts`
- Modify: `apps/api/src/index.ts` (mount under `/api`, after `requireAuth`)

**Interfaces:**
- Produces:
  - `GET /api/leads?page=N&status=new|contacted|converted|archived|all` → `{ data: Lead[], page, page_size: 20, total, total_pages, new_count }`
  - `PATCH /api/leads/:id` body `{ status }` (strict) → `{ data: Lead }` | 400 | 404
  - `LEADS_PAGE_SIZE = 20`

- [ ] **Step 1: Write the failing test.** Copy the scripted fake-builder pattern from `apps/api/src/routes/notifications.routes.test.ts:24-55`. Add `.eq()`, `.update()`, `.single()` and a `head: true` count path for `new_count`. Cases:
  1. `GET /` → `range(0,19)`, ordered `created_at desc`, no status `eq` (default `all`), envelope includes `new_count`.
  2. `GET /?status=new` → `eq('status','new')` recorded.
  3. `GET /?status=bogus` → 400. `GET /?page=0` → 400. `GET /?foo=1` → 400 (strict).
  4. `PATCH /L1 {status:'contacted'}` → 200, update payload is exactly `{ status: 'contacted' }`.
  5. `PATCH /L1 {status:'contacted', name:'x'}` → 400 (strict; staff cannot rewrite what the customer typed).
  6. `PATCH /missing` with fake returning `{data:null,error:{code:'PGRST116'}}` → 404.

- [ ] **Step 2: Run it and confirm it fails.** `cd apps/api && pnpm vitest run src/routes/leads.routes.test.ts`

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Staff Leads (authenticated, mounted at `/api/leads`).
 *
 * Rows are written only by the public `POST /intake/lead`
 * (`routes/leadIntake.ts`). Staff can list them (newest first, 20 per
 * page, optional status filter, with a `new_count` for the sidebar
 * badge) and move a lead between statuses. Nothing the visitor typed is
 * editable here; the row stays a faithful record of the enquiry.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { createSupabaseAdmin } from '../lib/supabase';
import type { AuthVariables } from '../middleware/auth';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/** Leads per page, fixed by the server like the Alerts feed. */
export const LEADS_PAGE_SIZE = 20;

const STATUSES = ['new', 'contacted', 'converted', 'archived'] as const;

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    status: z.enum([...STATUSES, 'all']).default('all'),
  })
  .strict();

const patchSchema = z.object({ status: z.enum(STATUSES) }).strict();

/** One page of leads plus the count of untouched (`new`) leads. */
app.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid query' }, 400);
  const { page, status } = parsed.data;
  const from = (page - 1) * LEADS_PAGE_SIZE;

  const sb = createSupabaseAdmin(c.env);
  let q = sb.from('leads').select('*', { count: 'exact' });
  if (status !== 'all') q = q.eq('status', status);
  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + LEADS_PAGE_SIZE - 1);
  if (error) return c.json({ error: error.message }, 500);

  const { count: newCount } = await sb
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');

  const total = count ?? 0;
  return c.json({
    data: data ?? [],
    page,
    page_size: LEADS_PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE)),
    new_count: newCount ?? 0,
  });
});

/** Moves a lead to another status. Body is `{ status }` only. */
app.patch('/:id', async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid status' }, 400);
  const sb = createSupabaseAdmin(c.env);
  const { data, error } = await sb
    .from('leads')
    .update({ status: parsed.data.status })
    .eq('id', c.req.param('id'))
    .select('*')
    .single();
  if (error?.code === 'PGRST116' || (!error && !data)) return c.json({ error: 'Lead not found' }, 404);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data });
});

export default app;
```

Mount in `index.ts`, after the notifications line:
```ts
/** Website leads — list + status changes; written by POST /intake/lead. */
app.route('/api/leads', leadsRoutes);
```

- [ ] **Step 4: Run the tests and the type check.** `cd apps/api && pnpm vitest run src/routes/leads.routes.test.ts && pnpm check && pnpm test`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/leads.ts apps/api/src/routes/leads.routes.test.ts apps/api/src/index.ts
git commit -m "feat(api): staff leads list and status endpoints"
```

---

### Task 7: Leads page in the staff app

**Files:**
- Modify: `apps/web/src/types/index.ts` (add `LeadStatus`, `Lead`)
- Create: `apps/web/src/hooks/useLeads.ts`
- Create: `apps/web/src/pages/leads/leadText.ts`, `leadText.test.ts`, `LeadRow.tsx`, `LeadsPage.tsx`
- Modify: `apps/web/src/App.tsx` (route `/leads`), `apps/web/src/components/Sidebar.tsx` (nav item between Customers and Calendar)

**Interfaces:**
- Consumes: `GET /api/leads`, `PATCH /api/leads/:id` (T6); `apiFetch` (`lib/api.ts:53`); `PageHeader`, `ListSkeleton`.
- Produces: `type LeadStatus = 'new'|'contacted'|'converted'|'archived'`; `interface Lead` (all columns from T1); `useLeads(page: number, status: LeadStatus | 'all')`; `useUpdateLeadStatus()` mutation `{ id, status }`; `leadAddress(lead): string`; `LEAD_STATUS_LABELS: Record<LeadStatus,string>`.

- [ ] **Step 1: Write the failing pure-helper test** (`leadText.test.ts`): `leadAddress` joins street+unit, city, "province postal" and skips blanks (`''` for an empty address). `LEAD_STATUS_LABELS` maps all four statuses to `New`, `Contacted`, `Converted`, `Archived`.

- [ ] **Step 2: Run it and confirm it fails.** `cd apps/web && pnpm vitest run src/pages/leads/leadText.test.ts`

- [ ] **Step 3: Implement `leadText.ts`**, mirroring the api's `addressLine`. Each export gets a JSDoc that says it is a display helper only.

- [ ] **Step 4: Types + hook.** Model `useLeads` on `hooks/useNotifications.ts`: queryKey `['leads', status, page]`, `staleTime: 0`, `keepPreviousData`, plus `refetchInterval: 60_000` so a lead that arrives while the page is open shows up within a minute. `useUpdateLeadStatus` uses `useMutation` → `apiFetch('/api/leads/'+id, { method:'PATCH', body: JSON.stringify({status}) })`, then on success runs `invalidateQueries({ queryKey: ['leads'] })`.

- [ ] **Step 5: `LeadRow.tsx`**: a card in the same style as the `NotificationRow` base classes. Collapsed, it shows the name, a status pill, the relative date and the city. Expanded (button toggle), it shows a `tel:` link for the phone, a `mailto:` link for the email, the address, the message (`whitespace-pre-wrap`) and the source page. A red "SMS not sent" / "Email not sent" note shows when the matching `*_sent_at` is null and the lead is more than 2 minutes old. A status button row (`Contacted`, `Converted`, `Archive`; plus `Reopen` when not `new`) calls the mutation.

- [ ] **Step 6: `LeadsPage.tsx`**: `PageHeader title="Leads"`. Filter chips (`All`, `New (n)`, `Contacted`, `Converted`, `Archived`) are driven by `?status=`, and the page by `?page=`. Both live in URL params like `NotificationsPage` (copy its `pageFromParams` + pager markup). Show an empty state per filter.

- [ ] **Step 7: Wire the route + nav.** `App.tsx`: `<Route path="/leads" element={guard(<Layout><LeadsPage /></Layout>)} />`. `Sidebar.tsx`: add `{ to: '/leads', label: 'Leads', d: 'M4 4h16v16H4z M4 4l8 8 8-8' }` (an envelope/inbox glyph) after Customers. Update the comment that says "The five sections" to six.

- [ ] **Step 8: Verify.** `cd apps/web && pnpm check && pnpm test && pnpm lint` → 0/0. Then drive the page in the browser preview against a local API with two seeded leads. Memory note: without `apps/web/.env` the app renders blank, so use the throwaway Vite harness if needed. Check: filter chips change the list, status buttons move a lead between filters, and phone width has no horizontal scroll.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/hooks/useLeads.ts apps/web/src/pages/leads apps/web/src/App.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): Leads page with status filter and actions"
```

---

### Task 8: Embeddable website form

**Files:**
- Create: `apps/web/public/embed/lead-form.js`
- Create: `apps/web/public/embed/test.html`, a local-only harness page that mimics the WordPress embed

**Interfaces:**
- Consumes: `POST {API}/intake/lead` (T5), Turnstile site key (public value).
- Produces: the two-line WordPress embed:

```html
<div id="bn-lead-form" data-api="https://blinds-nisa-api.<subdomain>.workers.dev" data-sitekey="0x4AAAA…"></div>
<script src="https://measure-blinds.blindsnisa.workers.dev/embed/lead-form.js" defer></script>
```

- [ ] **Step 1: Write `lead-form.js`.** It is an IIFE with no dependencies and no build step. Responsibilities, in order:
  1. Find `#bn-lead-form` and read `data-api` / `data-sitekey`. Attach `attachShadow({ mode: 'open' })` so Elementor/theme CSS cannot leak in.
  2. Render the bilingual fields from D5 with `<label for>` pairs, `required` on Name/Email/Consent, `type="email"`/`type="tel"`, `autocomplete` attributes (`name`, `email`, `tel`, `street-address`, `address-level2`, `address-level1`, `postal-code`), a `maxlength=1000` textarea with a live counter, and the consent checkbox with the existing wording ("I accept to receive emails, phone calls, and SMS from Blindsnisa Inc."). Render the honeypot `website` input inside an off-screen wrapper with `aria-hidden="true"` and `tabindex="-1"`.
  3. Load `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once. Call `turnstile.render(container, { sitekey, callback: t => token = t })` into a slot **in the light DOM**. Turnstile does not support rendering inside a shadow root, so the container is a sibling `div` appended after the host, or a `<slot>`.
  4. On submit: disable the button ("Sending…"), build the JSON with exactly the schema keys (`source_url: location.href`), and `fetch(api + '/intake/lead', { method:'POST', headers:{'Content-Type':'application/json'}, body })`.
  5. On `201`, replace the form with the thank-you message "Thank you! We'll contact you within 1 business day. / Merci! …". On `400`, show inline "Please check the highlighted fields." On `403`, show "Verification failed, please try again" and call `turnstile.reset()`. On `429`/`5xx`/network error, show "Something went wrong. Please call us at <company phone>". Pass the company phone in as a `data-phone` attribute.
  6. Style it with CSS variables at the top of the shadow stylesheet (`--bn-accent`, `--bn-radius`, `--bn-font: inherit`) so it can be matched to the site theme without code changes. The layout is a single column under 600px and two columns (city/province/postal) above.
- [ ] **Step 2: Local harness.** `test.html` contains the embed `<div>` with `data-api="http://localhost:8787"` and Cloudflare's always-passes **test** site key `1x00000000000000000000AA`. Set `.dev.vars` `TURNSTILE_SECRET=1x0000000000000000000000000000000AA` (the always-passes test secret).
- [ ] **Step 3: Verify end to end locally.** Run `wrangler dev` for the api and the web dev server. Open `/embed/test.html` in the browser preview, submit a lead, and check four things: a `201` in the network log, the row in the Leads page, the Worker log showing SMS + email attempts, and the thank-you state. Repeat the submission with an invalid email (inline error) and with the honeypot filled through devtools (400). Check at mobile width (375px) for no horizontal scroll.
- [ ] **Step 4: Commit**

```bash
git add apps/web/public/embed
git commit -m "feat(embed): self-contained website lead form"
```

---

### Task 9: Accounts, secrets, deploy and WordPress swap (user and ops steps)

These steps need the user's own accounts, so the agent cannot complete them alone. Each one is listed so nothing is forgotten.

- [ ] **Step 1: Twilio**. The user creates the account, buys a Canadian (613) number, and finishes any messaging registration Twilio asks for. Then:
  ```bash
  cd apps/api && npx wrangler secret put TWILIO_ACCOUNT_SID
  ```
  ```bash
  cd apps/api && npx wrangler secret put TWILIO_AUTH_TOKEN
  ```
  ```bash
  cd apps/api && npx wrangler secret put TWILIO_FROM
  ```
  On a Twilio **trial** account, the `LEAD_SMS_TO` number must first be verified in the Twilio console.
- [ ] **Step 2: Turnstile**. In the Cloudflare dashboard, go to Turnstile → Add widget, with hostnames `blindsnisa.com` and `www.blindsnisa.com`, mode Managed. The site key goes in the embed `data-sitekey`. The secret goes in with:
  ```bash
  cd apps/api && npx wrangler secret put TURNSTILE_SECRET
  ```
- [ ] **Step 3: Apply migration 44** (if not done in Task 1). Deploy the api, then the web Worker. Confirm `https://measure-blinds.blindsnisa.workers.dev/embed/lead-form.js` returns 200 with a `text/javascript` content type.
- [ ] **Step 4: Production smoke test** on a hidden WordPress draft page that holds only the embed: submit a real test lead. Confirm the SMS arrives, the email arrives with Reply-To set to the lead's email, the lead shows on `/leads`, and `sms_sent_at`/`email_sent_at` are stamped. Archive the test lead.
- [ ] **Step 5: Swap the form.** On `/free-estimate/`, edit with Elementor, delete the Forminator widget (form 913), add an **HTML** widget, paste the embed, and Update. Keep Forminator form 913 *deactivated, not deleted* for a week as a rollback. If a caching or optimisation plugin (e.g. Autoptimize/WP Rocket) defers or combines scripts, exclude `lead-form.js` and `challenges.cloudflare.com`.
- [ ] **Step 6: Docs.** Add an entry to `knowledge/history/engine_features.md` (2026-10-05, Website lead capture), update the current state in `memory-bank/activeContext.md` + `progress.md`, add the new secrets and vars to `memory-bank/techContext.md`, and add the `/intake` mount rationale to `systemPatterns.md`.

---

## Later (not in this plan)

- **Convert to customer.** One button on a lead creates a `customers` row (prefilled from the lead), sets `leads.customer_id` and `status='converted'`, and opens the customer. The column is already reserved in migration 44.
- **Book estimate visit from a lead.** Opens the existing appointment wizard prefilled.
- **Auto-reply email to the visitor** ("we got your request") using the branded shell.
- **Unread badge** on the Leads nav item from `new_count`.
- **Alerts feed entry** (`notifications.kind = 'lead_received'`, which needs a CHECK change).
- **Lead source / UTM capture** (`utm_source`, `gclid`) to tie Google Ads spend to leads.
- **Several recipients for the SMS**, or SMS only during business hours.

## Self-review notes

- Spec coverage: form replacement (T8, T9.5), leads in the app dashboard (T1, T6, T7), SMS to a fixed number (T3, T4, `LEAD_SMS_TO`), email on a new lead (T4). All are covered.
- Types: `LeadAlertRow` (T4) is a subset of the `leads` row (T1). The route passes `data` from `select('*')`. The `Env` keys added in T4 are the ones used in T5's test ENV and in T9 secrets.
- Risk: the Turnstile widget cannot render inside a shadow root, so T8 step 1.3 renders it in the light DOM.
- Risk: the in-memory rate limiter is per isolate (see `middleware/rateLimit.ts` header). Turnstile is the real defence here, and the limiter only reduces noise.
