# PrivGuard Nexus Dashboard

A Next.js dashboard that shows every pull-request review from the PrivGuard Nexus GitHub Action: the merge decision, risk scores, the review pipeline (rule flags, false positives dismissed by AI, new issues found by AI), a privacy-impact timeline and every finding with its evidence and fix. It also has built-in demo scenarios.

**Stack:** Next.js, React, Tailwind CSS, Prisma, PostgreSQL (Neon).

## How reports arrive

The Action sends each review to `POST /api/reports` with `Authorization: Bearer <DASHBOARD_TOKEN>`. Requests without the right token are rejected. `GET /api/reports` is public and read-only (latest 30 reviews).

## Deploy (Vercel + Neon)

1. Create a free Postgres database on [Neon](https://neon.tech) and copy its connection string.
2. Import the repository on [Vercel](https://vercel.com/new), set **Root Directory** to `dashboard`, and add environment variables:
   - `DATABASE_URL`: the Neon connection string
   - `DASHBOARD_TOKEN`: a long random string you make up
3. Deploy. The build runs `prisma migrate deploy`, which creates the tables.
4. In the repository that runs the Action, add the secret `DASHBOARD_TOKEN` (same value) and pass:

```yaml
          dashboard-url: 'https://your-dashboard.vercel.app'
          dashboard-token: ${{ secrets.DASHBOARD_TOKEN }}
```

## Run locally

```bash
npm install
# .env with DATABASE_URL and DASHBOARD_TOKEN
npx prisma migrate deploy
npm run dev
```

Requires Node.js 22.12 or newer.
