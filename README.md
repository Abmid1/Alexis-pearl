# Bilt Africa — Real Estate OS

One platform, many agencies. Each real estate company gets:

- **A private workspace** (the original Alexis Pearl CRM): pipeline, deals, unified inbox, marketing, finance, payment plans, reports, knowledge base, property management, and now **Viewings** and **Website** screens.
- **A public, branded website** at `/s/<company-slug>`: property search, listing pages, enquiries, viewing requests, request tracking, saved homes, an AI property assistant, and **customer accounts** with applications and private document uploads.

Both sides use the same backend and the same records. A listing approved in Marketing appears on the website immediately. An enquiry on the website becomes a lead and an inbox conversation, and a viewing confirmed by staff shows as confirmed to the customer.

## Stack
- **Frontend**: Next.js 14 App Router. The workspace is client-rendered. The public site is server-rendered for SEO and WhatsApp previews. Deploys to **Vercel**.
- **Backend**: Node/Express, JWT auth, role guards, and company-scoped data access. Deploys to **Render**.
- **Database**: Supabase Postgres, accessed only by the backend with the service key.
- **AI**: Gemini (optional). Every AI feature has a rule-based fallback.

## Setup

### 1 · Database
In Supabase → SQL Editor, run **in order**:
1. `backend/scripts/schema.sql`. **Fresh installs only: it drops every table.**
2. `backend/scripts/migrations/001_multi_company_public_site.sql`. Safe on an existing database. It is additive, and it attaches all existing data to the company `alexis-pearl`.
3. `backend/scripts/migrations/002_customer_portal_applications.sql`. Adds customer sign-in, saved homes, applications, a **private** storage bucket for documents, and verified payments.

Open each file in VS Code, copy all of its text, paste it into a new SQL Editor query and click Run. Pasting the file path does not work. Each file has a matching `.down.sql` rollback. Back up first, because rollbacks delete the data those migrations added.

### 2 · Backend
```bash
cd backend
copy .env.example .env     # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET
npm install
npm run seed               # demo data for two agencies (fresh database only)
npm run dev                # http://localhost:5000
npm test                   # 68 tests, no database needed
npm run dev:memory         # optional: whole backend on an in-memory demo database, no Supabase
```

### 3 · Frontend
```bash
cd frontend
copy .env.example .env.local
npm install
npm run dev                # http://localhost:3000  → workspace;  /s/alexis-pearl → public site
```

## Demo logins (password: `demo1234`)
| Email | Company | Role |
|---|---|---|
| owner@alexispearl.com | Alexis Pearl | Owner |
| admin@alexispearl.com | Alexis Pearl | Admin |
| kojo@alexispearl.com / efua@alexispearl.com | Alexis Pearl | Agents |
| client@alexispearl.com | Alexis Pearl | Client portal |
| owner@sunrisehomes.test | Sunrise Homes | Owner of a second agency, for checking isolation |

Public sites: `/s/alexis-pearl`, `/s/sunrise-homes`.

## How multi-company isolation works
- Every company-owned table has `company_id`. The company comes from the signed-in user's token for staff, or from the URL slug looked up on the server for the public site. It is never taken from a request body.
- Routes query through `tenantDb(companyId)` in `backend/src/lib/tenant.js`. It adds the company filter to every read, update and delete, and stamps it on every insert. Child tables are reached only through a verified parent: messages, installments and commission splits.
- Ids passed in request bodies, such as `property_id` or `owner_id`, are checked to belong to the same company.
- Background jobs run once per company.
- Row Level Security is switched on for every table. Only the backend's service key can read data, and the public anon key cannot.

## Listing publication rules
| Workspace state | Public site |
|---|---|
| Draft, awaiting approval, rejected | Hidden |
| Published + Available | Listed; enquiries and viewing requests open |
| Published + Reserved | Listed with badge; enquiries only |
| Published + Under offer | Listed with badge; enquiries and viewings |
| Published + Temporarily unavailable | Listed with badge; no new requests |
| Published + Rented / Sold | Hidden from default search, page still loads with an honest notice, no new requests |
| Unpublished or archived | Gone from search and detail pages immediately |

Staff set availability in Marketing. Every change, plus a "Still accurate" button, records when it was last checked, and the date is shown publicly.

## Enquiries and viewings
- **Enquiry flow:** validate on the server, check the property belongs to the company and is open, then match the existing lead. Matching uses phone or email only, never name. A conflicting match creates a new lead flagged as a possible duplicate. The enquiry then lands in the Inbox with an **AI draft that is never auto-sent**. Retries with the same request key are ignored.
- **Viewings:** customers choose from slots generated from the company's schedule, set in Website → Viewing schedule. A request always shows **"Awaiting confirmation"**. Postgres exclusion constraints block overlapping *confirmed* viewings for the same property or the same agent. Confirming moves an early-stage lead to the "viewing" stage.
- **Customer updates:** customers check status, read agent replies, reply, cancel or reschedule at `/s/<slug>/track`. They need their reference plus the phone or email they used. No accounts or tokens appear in URLs.
- **Notifications:** sent only if the customer ticked consent, through the existing outbox, with a de-duplication key. WhatsApp sends for real only when credentials are set, and email is always recorded as `simulated`.

## Customer accounts, applications and documents
- **Sign-in:** customers sign in with a 6-digit code sent to their phone by WhatsApp or to their email. There are no passwords. Codes are stored hashed, expire after 10 minutes, lock after 5 wrong tries, and are limited to 3 per contact per 15 minutes. They are redacted in the outbox so staff can't read them. On a live server, sign-in is refused for any channel without a real provider. Locally, the code prints in the backend terminal.
- **Sessions** last 7 days and work only for one agency. Staff routes reject them.
- **What a customer sees:** only requests made with a phone or email they have proven by code. Changing their name never grants access to anything.
- **Saved homes** sync to the account and across devices. Unpublished listings drop out automatically.
- **Applications** use questions each agency sets in **Website → Application questions**. Staff manage them in **Applications**: review, ask for information and specific documents, approve or decline, and add internal notes. Only owners and admins can approve or decline. Each application also lands in the Inbox and on the lead.
- **Documents** are limited to PDF, JPG, PNG and WebP up to 8 MB. The type is checked from the file's actual bytes, not its name. Files go to the private Supabase bucket `application-documents` and are only reachable through download links that expire after 60 seconds. Every view by staff or customer is logged in the audit log.

## Payments (Paystack)
- An installment is marked paid only after Paystack's signed webhook arrives **and** the backend re-checks the transaction with Paystack. The check covers amount, currency, company and installment. A redirect alone never counts.
- Set the webhook URL in the Paystack dashboard to `https://<backend>/api/webhooks/paystack`.

## Customer AI assistant
- It is read-only and uses the same published-only search as the website, scoped to the agency being visited. It never creates records. It links customers to the normal booking and enquiry forms instead.
- Listing text goes to the model as untrusted, fenced data. Any reply that quotes a price not present in the data is discarded in favour of a deterministic answer.
- Policy questions are answered only from knowledge-base documents a manager has marked **On website**. Client documents can never be made public. The demo FAQ stays private because it claims every title is verified.

## Environment variables
See `backend/.env.example` and `frontend/.env.example`. The new or changed ones are listed below.

| Variable | Where | Purpose |
|---|---|---|
| `NODE_ENV=production` | backend | Hides internal errors, requires `JWT_SECRET`, disables simulated payments |
| `WHATSAPP_VERIFY_TOKEN` | backend | Now required for Meta verification; the old built-in default is removed |
| `WHATSAPP_APP_SECRET` | backend | Optional webhook signature check |
| `DEFAULT_COMPANY_SLUG` | backend | Fallback company for unmapped inbound WhatsApp numbers |
| `API_URL` | frontend | Backend URL for server rendering, if different from the public URL |
| `NEXT_PUBLIC_SITE_URL` | frontend | Origin used in sitemaps |
| `NEXT_PUBLIC_ROOT_DOMAIN` | frontend | Enables `<slug>.<domain>` subdomains |
| `CUSTOM_DOMAINS=1` + `APP_HOSTS` | frontend | Enables agencies' own domains; `APP_HOSTS` lists the workspace's hostnames |
| `PAYSTACK_CALLBACK_URL` | backend | Where Paystack sends the customer after paying, e.g. `https://<app>/portal` |

## Domains
- **Works today:** `https://<your-vercel-domain>/s/<slug>`.
- **Subdomains** such as `abcproperties.biltafrica.com`: add a wildcard DNS record `*.biltafrica.com` pointing to Vercel, add the wildcard domain in Vercel, and set `NEXT_PUBLIC_ROOT_DOMAIN=biltafrica.com`. The Next.js middleware maps the subdomain to `/s/<slug>`.
- **Custom domains** such as `www.abcproperties.com`:
  1. The owner enters the domain under Website.
  2. The agency points the domain's DNS to Vercel.
  3. Add the domain to the Vercel project.
  4. Set `CUSTOM_DOMAINS=1` and `APP_HOSTS=<your workspace host>`.

  The middleware looks up which agency owns the domain and caches the answer for 5 minutes.
- Per-agency sitemap: `/s/<slug>/sitemap.xml`. `robots.txt` allows `/s/` and blocks the workspace.

## Tests
`npm test` in `backend` runs unit, integration and journey tests against an in-memory stand-in for Supabase. They cover the spec's acceptance list:

- publishing, editing and unpublishing listings
- search, enquiries into the CRM, and deduplication
- viewing request → confirm → customer status, and double booking
- cross-company access attempts
- the assistant's grounding
- regression of existing CRM routes

The stand-in is not Postgres. RLS, the exclusion constraints and the migration itself still need a run against a real Supabase database.

## Known gaps
- **No email provider is connected.** Email sign-in codes are refused on a live server, and email notifications are recorded in the outbox only. Connect a provider such as Resend or Postmark in `lib/integrations.js`.
- **WhatsApp needs Meta approval.** Codes and updates sent outside Meta's 24-hour window need approved message templates.
- **Uploaded documents are not scanned for malware.** The format allow-list limits the risk. Add a scanning service before scaling.
- **Rate limits are per server instance**, held in memory. Use Redis or Upstash if you run several instances.
- **Property photos are URLs.** There is no upload yet.
- **Not built:** offers, transaction milestones, tenant maintenance requests on the website, and landlord property submission. The applications model is the pattern for adding them.

## Cron (runs inside the backend, Africa/Accra time)
- Daily 8am: WhatsApp payment reminders per company (de-duplicated), plus the overdue sweep
- Monday 7am: weekly digest per company
