// Admin-only account removal. The service-role key stays in Edge Function secrets.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });

  const authorization = request.headers.get('Authorization') ?? '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json(401, { error: 'A valid signed-in session is required.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Missing Supabase Edge Function environment secrets.');
    return json(500, { error: 'The account deletion function is not configured.' });
  }

  // Verify JWT with Auth, then query the caller's profile using their own JWT/RLS.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return json(401, { error: 'The session token is invalid or expired.' });
  const callerId = authData.user.id;

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles').select('id, role, status').eq('id', callerId).maybeSingle();
  if (profileError) {
    console.error('Could not verify caller profile:', profileError.message);
    return json(403, { error: 'Could not verify administrator access.' });
  }
  if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.status !== 'active') {
    return json(403, { error: 'Only an active admin can delete accounts.' });
  }

  let payload: { userId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'Request body must be valid JSON.' });
  }
  const targetId = typeof payload.userId === 'string' ? payload.userId : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
    return json(400, { error: 'A valid target user ID is required.' });
  }
  if (targetId === callerId) return json(400, { error: 'You cannot delete your own account.' });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: target, error: targetError } = await serviceClient
    .from('profiles').select('id, full_name, email, role').eq('id', targetId).maybeSingle();
  if (targetError) {
    console.error('Could not inspect deletion target:', targetError.message);
    return json(500, { error: 'Could not verify the target account.' });
  }
  if (!target) return json(404, { error: 'The target account was not found.' });
  if (target.role === 'admin') return json(403, { error: 'Admin accounts cannot be deleted from this tool.' });

  // Record intent before the destructive call. If deletion fails, the record is
  // changed to a failure action. The FK becomes NULL on successful user deletion,
  // while details retain the target ID for the audit trail.
  const { data: audit, error: auditError } = await serviceClient
    .from('audit_logs')
    .insert({
      admin_id: callerId,
      action: 'user_deletion_requested',
      target_user_id: targetId,
      details: { target_user_id: targetId, target_name: target.full_name, outcome: 'pending' }
    })
    .select('id').single();
  if (auditError || !audit) {
    console.error('Could not create deletion audit record:', auditError?.message);
    return json(500, { error: 'Could not write an audit record; no account was deleted.' });
  }

  const { error: deletionError } = await serviceClient.auth.admin.deleteUser(targetId);
  if (deletionError) {
    const { error: auditUpdateError } = await serviceClient.from('audit_logs').update({
      action: 'user_deletion_failed',
      details: { target_user_id: targetId, target_name: target.full_name, outcome: 'failed', reason: deletionError.message }
    }).eq('id', audit.id);
    if (auditUpdateError) console.error('Could not record deletion failure:', auditUpdateError.message);
    console.error('Auth user deletion failed:', deletionError.message);
    return json(500, { error: 'Supabase could not delete the account. Check the audit log and function logs.' });
  }

  const { error: finalAuditError } = await serviceClient.from('audit_logs').update({
    action: 'user_deleted',
    details: { target_user_id: targetId, target_name: target.full_name, outcome: 'deleted' }
  }).eq('id', audit.id);
  if (finalAuditError) {
    console.error('User deleted but final audit update failed:', finalAuditError.message);
    return json(500, { error: 'The account was deleted, but the audit record could not be finalized. Check function logs.' });
  }

  return json(200, { success: true, deletedUserId: targetId });
});
