# Campus Connect

A mobile-first Progressive Web App foundation for a university student community platform. The project includes a responsive landing page, registration/login/password recovery interfaces, and a Supabase Auth client integration foundation. Authentication requests have not been verified against the live Supabase project.

## Project structure

```text
.
├── assets/icons/icon.svg
├── src/
│   ├── css/
│   │   ├── auth.css
│   │   └── styles.css
│   └── js/
│       ├── app.js
│       ├── auth.js
│       ├── supabase-client.js
│       └── supabase-config.js
├── auth.html
├── index.html
├── manifest.webmanifest
├── service-worker.js
└── README.md
```

## Run locally

Serve the project directory with a local HTTP server (service workers require HTTPS or localhost). For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. The Supabase JavaScript client is loaded as an ES module from esm.sh using the official `@supabase/supabase-js` v2 package, so the browser needs internet access to load that dependency.

## Supabase setup

1. In `src/js/supabase-config.js`, set `SUPABASE_URL` to your project URL and `SUPABASE_ANON_KEY` to its publishable key (legacy anon key is also supported). The client normalizes a URL that ends in `/rest/v1/` to the project root.
2. Never place a Supabase `service_role` or secret key in browser code. Publishable/anon keys are intended for clients, but must be protected by correctly configured Row Level Security policies.
3. In Supabase Auth settings, configure allowed site/redirect URLs for your local and deployed `auth.html` locations. Confirm the email redirect URL is allowed.
4. Set the allowed university email domain in the client validation once the institution/domain is known. Current validation checks valid email syntax but does not guess the institution's domain.
5. Create appropriate profile-table policies before storing student profile data in the database. Registration currently places full name and matriculation number in Supabase Auth user metadata; it does not create a database profile row.

Registration, password login, and password recovery call Supabase Auth APIs when valid configuration is present. This code has not been run against the live project; test signup, email confirmation, login, reset email delivery, redirect URLs, and project policies before relying on it in production. No dashboard or password-update callback flow is included yet.
