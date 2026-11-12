# Delete-user Edge Function

This function permanently deletes a non-admin Supabase Auth account and its profile. It verifies the caller's JWT and active admin profile, rejects self-deletion and deletion of any admin, and writes the outcome to `public.audit_logs`. The Supabase service-role key is read only from the Edge Function environment and must never be added to frontend code.

## Configure the function secret

1. Open your project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **Project Settings → Edge Functions → Secrets** (or **Edge Functions → Secrets**, depending on the dashboard layout).
3. Add `SUPABASE_SERVICE_ROLE_KEY` with the project's service-role secret. Copy it from **Project Settings → API**; do not put it in this repository or any browser configuration.
4. The function also uses the platform-provided `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment values. If either is not available in your project, add it as an Edge Function secret as well.

Secret changes are made in Supabase; do not commit a local `.env` file containing service-role credentials.

## Deploy

Install and authenticate the Supabase CLI, link the local project to the intended Supabase project, and deploy from the repository root:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy delete-user
```

The function requires a signed-in caller's bearer JWT. Keep JWT verification enabled for the deployed function. The admin panel invokes it with the current Supabase session and sends only the target profile ID.

## Verify

Use an active admin account to delete a non-admin test account from the admin panel. Confirm the request is refused for the current admin and for any other admin account, and check the Audit log for `user_deleted`. Do not test against an account containing data you need to retain.
