# Campus Connect

A mobile-first Progressive Web App foundation for a university student community platform. This initial version includes a responsive landing page and the groundwork for future Supabase integration; product features and authentication are not implemented yet.

## Project structure

```text
.
├── assets/
│   └── icons/
│       └── icon.svg
├── src/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js
│       └── supabase-config.js
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

Then open `http://localhost:8000`.

## Supabase setup

1. Create a Supabase project.
2. Add the project URL and publishable/anon key to `src/js/supabase-config.js`.
3. Keep Row Level Security enabled and add suitable policies before accessing data.
4. Never place a Supabase `service_role` key in browser code.

The Supabase client SDK and authentication/database features are intentionally not included yet.
