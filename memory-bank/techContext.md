# Tech Context

## Technologies
| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | v22 LTS (>=22 required) | Runtime — wrangler 4 requires Node 22+; Node 20 EOL April 2026 |
| pnpm | latest | Package manager (workspaces) |
| TypeScript | ~6.0.2 | Type safety |
| React | ^19.2.7 | UI framework |
| Vite | ^8.1.0 | Build tool / dev server |
| Tailwind CSS | ^4.1.0 | Utility-first CSS (v4 with @tailwindcss/vite plugin) |
| React Router | ^6.30.0 | Client-side routing |
| Zustand | ^5.0.0 | Local UI state management |
| TanStack Query | ^5.80.0 | Server state management |
| Hono.js | ^4.7.0 | Cloudflare Worker web framework |
| Supabase JS | ^2.49.0 | Database client + Auth |
| jose | ^6.0.0 | JWT verification via JWKS |
| Zod | ^3.25.0 | Runtime schema validation |
| date-fns | ^4.1.0 | Date manipulation |
| react-day-picker | ^9.7.0 | Calendar date picker component |
| react-hot-toast | ^2.5.0 | Toast notifications |
| Wrangler | ^4.20.0 | Cloudflare Workers CLI |
| Vitest | ^3.2.0 | Unit tests for money math (`pnpm --filter web test`) |

## Dependencies (to be set up)
| Service | Purpose | Status |
|---------|---------|--------|
| Supabase | Database + Auth | Project exists: `lgbxxlwsdeuhdgzrjjen` — migrations pending |
| Cloudflare | Pages + Workers hosting | Not yet created |
| Resend.com | Transactional email | Not yet created |

## Development Setup
```bash
# Install dependencies
pnpm install

# Start frontend dev server
pnpm dev:web    # → http://localhost:5173

# Start API dev server
pnpm dev:api    # → http://localhost:8787

# Start both simultaneously
pnpm dev
```

## Environment Variables
### Worker secrets (via `wrangler secret put`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `APP_URL`

### Frontend (.env)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`

## Technical Constraints
- Cloudflare Workers: 10ms CPU time limit (free tier), no Node.js APIs
- Supabase free tier: 500MB database, 1GB storage, 50,000 auth users
- Resend free tier: 100 emails/day, 1 domain
