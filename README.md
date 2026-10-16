# Train Well

Training management for managers across all Train Well facilities: employees, courses, training records,
certification expiry, sessions and attendance — behind a secure manager login.

**Built with:** plain HTML/CSS/JavaScript (no build step) hosted free on **GitHub Pages**, and **Supabase**
(free tier) for the database and logins.

---

## What it does

| Area | What managers can do |
|---|---|
| **Sign in** | Email + password login. Forgot-password emails. Inactive accounts are blocked. |
| **Dashboard** | Compliance % for mandatory training, expiring (next 30 days), expired and never-completed counts, compliance by facility, who needs attention, upcoming sessions. |
| **Employees** | Add, edit, search and filter ~200+ employees. Import/export CSV. Click a name to see their full training history and mandatory-training status. |
| **Training records** | Record completions for one or many employees at once. Expiry dates fill in automatically from the course's validity period. Filter by course/status/facility, export CSV. |
| **Sessions & attendance** | Schedule classes per facility, book employees, mark attendance. Marking someone *Attended* creates their training record automatically. |
| **Courses** | Course catalogue with category, hours, validity period and a *mandatory* flag. |
| **Users** *(admin)* | Add new manager/admin logins, assign them to a facility, deactivate them, send password resets. |
| **Facilities** *(admin)* | Rename the 3 starter facilities, add addresses, add more facilities later. |

### Who sees what
- **Admin** — everything, across all facilities. Manages courses, users and facilities.
- **Manager** — only their own facility's employees, sessions and records.

This is enforced **in the database** (Row Level Security in `supabase/schema.sql`), not just hidden in the page,
so a manager can't see another facility's data even by poking at the browser.

---

## Setup (about 20 minutes, one time)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) and click **New project** (free tier is fine for 200 employees).
   Pick the **Canada (Central)** region if you want data kept in Canada.
2. When it's ready, open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   *Tip: rename `Facility 1/2/3` near the bottom of the file to your real facility names first — or rename them later in the app.*

### 2. Lock down sign-ups and make your admin login
1. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".
   (Only admins should create accounts, from inside the app.)
2. **Authentication → Users → Add user → Create new user**: your email + a strong password, tick **Auto Confirm User**.
3. Open [`supabase/first-admin.sql`](supabase/first-admin.sql), change the name and email, and run it in the SQL Editor.

### 3. Connect the website to Supabase
1. In Supabase go to **Project Settings → API** (or **Data API**). Copy the **Project URL** and the **anon public** key.
2. In this repo, edit [`js/config.js`](js/config.js) and paste them in. Commit the change.
   > The anon key is meant to be public. **Never** paste the `service_role` key anywhere in this repo.

### 4. Deploy the "add user" function
The **Add user** button needs a small server function (it uses a secret key that must not be in the browser).

**Easiest — from the dashboard:** Supabase → **Edge Functions → Deploy a new function → Via Editor**. Name it
exactly `create-user`, paste the contents of
[`supabase/functions/create-user/index.ts`](supabase/functions/create-user/index.ts), and click **Deploy**.

**Or with the CLI:**
```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-ID
npx supabase functions deploy create-user
```

### 5. Publish on GitHub Pages
1. In this GitHub repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch **main**, folder **/ (root)**, **Save**.
2. After a minute your site is live at `https://YOUR-GITHUB-NAME.github.io/REPO-NAME/`.
3. Back in Supabase: **Authentication → URL Configuration** — set **Site URL** to that address and add it under
   **Redirect URLs** too (so password-reset emails link back to your site).

### 6. Sign in and load your data
1. Open the site and sign in with your admin account.
2. **Facilities** — rename the 3 facilities.
3. **Courses** — adjust the starter courses (WHMIS, First Aid/CPR, Fire Safety, Orientation) and add your own.
4. **Employees → Import CSV** — load your staff list. Use
   [`sample-data/employees-template.csv`](sample-data/employees-template.csv) as the template;
   the `facility` column must match a facility name exactly.
5. **Users → Add user** — create a login for each facility manager.

---

## Everyday use

- **Recording a course for a group:** Training records → **Record training** → tick everyone (use *Select shown*
  with the facility filter) → pick the course and date.
- **Running a class:** Sessions → **Schedule session** → **Attendance** → add employees → after the class set them
  to *Attended* (or *Mark everyone attended*) → **Save**. Records are created automatically.
- **Monthly check:** the Dashboard's *Needs attention* list, or Training records filtered to *Expiring*/*Expired*,
  then **Export CSV**.

## Files

```
index.html                 Sign-in page
app.html                   The app (after sign-in)
css/styles.css             Styling
js/config.js               ← your Supabase URL + anon key go here
js/client.js               Supabase connection
js/auth.js                 Sign-in / password reset
js/app.js                  All app pages
supabase/schema.sql        Database tables, security rules, starter data
supabase/first-admin.sql   Makes your first admin
supabase/functions/create-user/index.ts   Server function for "Add user"
sample-data/employees-template.csv        CSV import template
```

## Security notes
- Data access rules live in the database (Row Level Security) — admins see all, managers only their facility.
- Public sign-up is disabled; only admins create accounts.
- Deactivated users are blocked from the app immediately.
- Supabase handles password hashing, sessions and reset emails.
- Supabase free projects pause after a week with no activity; upgrade to Pro (~US$25/mo) for daily-use production
  and automatic backups.

## Ideas for later
Employee self-service logins, certificate file uploads, automatic email reminders before expiry,
training matrix by job title, printable reports.
