# Alexis Pearl — Real Estate OS

One system for the whole company: every channel feeds one database, every department reads and writes the same records, AI handles the repetitive answering and reminding.

Built from `BUILD_PROMPT.md` + the Dashboard Architecture blueprint (screens 1a–1k).

## Stack
- **Frontend** — Next.js 14 (App Router), mobile-first, PWA-friendly → deploys to **Vercel**
- **Backend** — Node/Express, JWT auth, role-based access → deploys to **Render**
- **Database** — Supabase (Postgres), single source of truth
- **AI** — Gemini (optional; graceful fallback drafts without a key)

## First-time setup

### 1 · Database
Open your Supabase project → SQL Editor → paste and run `backend/scripts/schema.sql`.

### 2 · Backend
```bash
cd backend
copy .env.example .env     # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET
npm install
npm run seed               # realistic Accra/GHS demo data
npm run dev                # http://localhost:5000
```

### 3 · Frontend
```bash
cd frontend
npm install
npm run dev                # http://localhost:3000
```
For production set `NEXT_PUBLIC_API_URL` to the Render backend URL.

## Demo logins (password: `demo1234`)
| Email | Role | Sees |
|---|---|---|
| owner@alexispearl.com | Owner | Everything + approvals |
| admin@alexispearl.com | Admin | Everything + approvals |
| kojo@alexispearl.com | Agent | Own leads, deals, inbox |
| efua@alexispearl.com | Agent | Own leads, deals, inbox |
| client@alexispearl.com | Client | Portal 1k only |

## Screens
1a Command Center · 1b Pipeline · 1c Deals & Commission · 1d Unified Inbox ·
1e Marketing · 1f Finance · 1g Payment Plans · 1h Weekly Report ·
1i AI Knowledge Base · 1j Property Management · 1k Client Portal · Audit Log

## Integration seams (connect per phase)
| Integration | Env var | Without it |
|---|---|---|
| Gemini AI | `GEMINI_API_KEY` | deterministic fallback drafts |
| WhatsApp Business API | `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | outbox records as `simulated` |
| Paystack (portal payments) | `PAYSTACK_SECRET_KEY` | simulated checkout posts instantly |

Webhook URL for Meta: `https://<render-url>/api/webhooks/whatsapp` (verify token = `WHATSAPP_VERIFY_TOKEN`).
Public website chatbot endpoint: `POST /api/webhooks/webchat` `{ visitor_id, name, body }`.

## Cron (runs inside the backend)
- Daily 8am — WhatsApp payment reminders (due ≤ 3 days), overdue flips
- Monday 7am — weekly digest auto-sends to all department heads
