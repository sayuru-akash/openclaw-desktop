# OpenClaw Auth Web

Next.js App Router auth service scaffolded with Clerk.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example` and set Clerk keys:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_SECRET_KEY
```

3. Run dev server:

```bash
npm run dev
```

## Routes

- `/` basic auth status page
- `/sign-in` Clerk sign-in
- `/sign-up` Clerk sign-up
- `/api/auth/session` session status JSON
