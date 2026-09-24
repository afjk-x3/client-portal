# Client Portal

Firms send clients a checklist of documents and questions. Clients sign in with a 6-digit code sent by email, upload files or answer each item, and submit it. Staff accept each item or return it with a note. Daily reminders chase open items, and a daily digest tells staff what arrived.

Design: [`docs/superpowers/specs/2026-09-24-client-portal-design.md`](docs/superpowers/specs/2026-09-24-client-portal-design.md)

## Stack

Next.js 16 (App Router, Cache Components), Supabase (Postgres with RLS, Auth, Storage), Tailwind CSS v4 with shadcn/ui, Resend, and Vercel Cron.

## Local development

Requires Node.js 22 or later and Docker.

```bash
npm install
npx supabase start          # Postgres, Auth, Storage, and Mailpit
cp .env.example .env.local  # then paste the keys printed by `npx supabase status`
npm run dev
```

Sign-in codes arrive in Mailpit at http://127.0.0.1:54324. While `RESEND_API_KEY` is empty, app emails are printed to the terminal instead of sent.

## Tests

| Command | Runs |
|---|---|
| `npm test` | Vitest unit tests |
| `npm run test:db` | pgTAP tests for tenant isolation, RPCs, and storage (local Supabase) |
| `npm run test:e2e` | The Playwright happy path (starts `npm run dev`) |
| `npm run typecheck` | Route type generation and `tsc` |
| `npm run lint` | ESLint |

After changing a migration, run `npx supabase db reset` and then `npm run db:types`.

## Environment variables

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (or the legacy anon key) |
| `SUPABASE_SECRET_KEY` | Secret key (or the legacy service-role key). Server only. |
| `NEXT_PUBLIC_SITE_URL` | Base URL for links in emails |
| `RESEND_API_KEY` | Resend API key. Empty in development. |
| `EMAIL_FROM` | Sender address on a domain verified in Resend |
| `CRON_SECRET` | Bearer token that Vercel Cron sends to `/api/cron/daily` |

## Deploying

1. Create a Supabase project, then link it and apply the migrations:

   ```bash
   npx supabase link --project-ref your-project-ref
   npx supabase db push
   ```

2. In the Supabase dashboard, under Authentication:
   - Set the email OTP length to 6.
   - Keep "Confirm email" on (the default). With it off, anyone could sign up with a password for someone else's address and get a session.
   - Replace the "Magic Link" and "Confirm signup" email templates with `supabase/templates/sign-in-code.html`. It shows `{{ .Token }}` and no link.
   - Configure custom SMTP with Resend.
   - Under Rate Limits, raise the email sending limit to your expected peak. Sign-in codes for every firm share this one limit, and the default is low. If sign-in emails are abused, turn on CAPTCHA protection (the sign-in form then needs a CAPTCHA widget).
   - Set the Site URL to the production domain.
3. In Resend, verify the domain of `EMAIL_FROM`.
4. In Vercel, set every variable above (use a long random `CRON_SECRET`) and deploy. `vercel.json` schedules `/api/cron/daily` at 13:00 UTC. On the Hobby plan it runs once at some point within that hour.

Before charging customers, move to paid plans: Vercel Hobby is for non-commercial use only, and Supabase pauses inactive free projects.
