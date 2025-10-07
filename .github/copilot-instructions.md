## Purpose

This file tells AI coding agents how this repository is organized and highlights patterns and files you should read before making changes.

## Big picture

- Next.js 15 (app router) frontend with server and client components under `app/`.
- Clerk handles authentication (see `app/layout.js`, `middleware.js`, and many `actions/*.js`).
- Prisma (Postgres/Neon) is the primary DB accessed via `lib/prisma.js` (exported as `db`).
- Background AI jobs use Inngest + Google Generative AI (Gemini) in `lib/inngest/*`.
- UI components follow the shadcn pattern under `components/ui/` and are imported using the `@/*` path alias from `jsconfig.json`.

## Quick start / dev commands

- Install & dev: `npm install` then `npm run dev` (Next dev uses `--turbopack`).
- Build / start: `npm run build` and `npm run start`.
- Postinstall runs `prisma generate` so ensure `DATABASE_URL` is set in `.env` before `npm install` in CI.

## Important environment variables

- `DATABASE_URL` (Postgres/Neon)
- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, sign-in/out redirects (see `README.md`)
- `GEMINI_API_KEY` (used by `lib/inngest/*`)

## Patterns & conventions (project-specific)

- Path aliases: imports use `@/` to reference repository root (see `jsconfig.json`).
- Prisma client: use `import { db } from '@/lib/prisma'`. `lib/prisma.js` uses a `globalThis.prisma` reuse pattern — do not instantiate new PrismaClients elsewhere.
- Auth: server-side helpers use Clerk's server APIs. Look at `lib/checkUser.js` and `actions/*.js` for examples:
  - `checkUser()` calls `currentUser()` and upserts a `User` in the DB.
  - Actions use `auth()` or `currentUser()` and then query `db.user.findUnique({ where: { clerkUserId } })`.
- Background AI: Inngest functions (e.g., `lib/inngest/function.js`) wrap Gemini calls with `step.ai.wrap` and expect strictly formatted JSON from the model — the code strips code fences and does `JSON.parse`.

## Key files to read before editing

- `prisma/schema.prisma` — canonical data model (User, Resume, CoverLetter, IndustryInsight, Assessment).
- `lib/prisma.js` — shared Prisma client export.
- `lib/checkUser.js` — Clerk ↔ DB user sync pattern.
- `middleware.js` — route protection and route matcher usage for Clerk.
- `lib/inngest/client.js` and `lib/inngest/function.js` — how background jobs, GEMINI keys, and cron are wired.
- `actions/*.js` — examples of server-side operations (auth + DB updates + returning structured results).
- `app/(auth)` and `app/(main)` — routing layout groups and auth flow.

## AI-specific guidance when editing code

- When modifying Inngest functions: preserve the exact prompt/JSON contract used in `lib/inngest/function.js` because the code expects parseable JSON (it strips ```json fences and uses `JSON.parse`).
- Avoid changing the Prisma client pattern. Use `db` from `lib/prisma.js` to preserve connection reuse across hot reloads.
- When you need to reference the current user on server routes, follow `checkUser()` or `actions/*` patterns — use `clerk` server helpers and store `clerkUserId` as the unique link to `User`.

## Examples (copyable snippets)

- Find the current user and upsert in DB (pattern):

- Inngest AI response parsing (pattern): model response -> strip backticks -> JSON.parse -> update `industryInsight`.

## Where to run tests / lint / build

- Lint: `npm run lint` (uses Next.js ESLint config).
- No unit tests included in the repo. For quick smoke, run `npm run dev` and exercise pages that hit `actions/*` and `api/inngest/route.js`.

## When uncertain, read these first

1. `prisma/schema.prisma` — to understand data shape and relations.
2. `lib/prisma.js` — DB client pattern.
3. `lib/checkUser.js` and `actions/*` — auth+DB examples.
4. `lib/inngest/function.js` — background AI contract.

If anything referenced above is unclear, ask a short clarifying question and point to the specific file(s) you inspected.
