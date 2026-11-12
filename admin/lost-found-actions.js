import { supabase } from '../src/js/supabase-client.js';

async function audit(adminId, action, targetUserId, details) {
  const { error } = await supabase.from('audit_logs').insert({
    admin_id: adminId,
    action,
    target_user_id: targetUserId,
    details
  });
  if (error) alert(`Saved, but the audit log failed: ${error.message}`);
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-lf-action]');
  if (!button) return;
  event.stopPropagation();
  event.preventDefault();
  if (button.disabled) return;

  const action = button.dataset.lfAction;
  const id = button.dataset.id;
  const approving = action.startsWith('approve');
  const isClaim = action.endsWith('claim');
  const decision = approving ? 'approved' : 'rejected';

  if (!window.confirm(`Are you sure you want to ${approving ? 'approve' : 'reject'} this ${isClaim ? 'claim' : 'item'}?`)) return;

  const card = button.closest('.lost-found-card');
  const buttons = card ? [...card.querySelectorAll('button')] : [button];
  buttons.forEach((b) => { b.disabled = true; });

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('You are not logged in.');
    const adminId = session.user.id;
    let targetUserId = null;

    if (!isClaim) {
      const { data, error } = await supabase.from('lost_found_items')
        .update({ status: decision })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id, owner_id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This item is no longer pending. Tap Refresh and try again.');
      targetUserId = data.owner_id;
    } else {
      const { data: claim, error: readError } = await supabase.from('lost_found_claims')
        .select('id, item_id, claimant_id')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!claim) throw new Error('This claim was not found.');
      targetUserId = claim.claimant_id;

      if (approving) {
        const { data: itemUpdated, error: itemError } = await supabase.from('lost_found_items')
          .update({ status: 'claimed' })
          .eq('id', claim.item_id)
          .eq('status', 'approved')
          .select('id')
          .maybeSingle();
        if (itemError) throw itemError;
        if (!itemUpdated) throw new Error('Only claims on approved items can be approved.');
      }

      const { data: claimUpdated, error: claimError } = await supabase.from('lost_found_claims')
        .update({ status: decision })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimUpdated) throw new Error('This claim is no longer pending. Tap Refresh and try again.');
    }

    await audit(adminId, `lost_found_${isClaim ? 'claim' : 'item'}_${decision}`, targetUserId, { id, decision });
    alert(`Done: ${decision}.`);
    card?.remove();
  } catch (error) {
    alert(error.message || 'Something went wrong.');
    buttons.forEach((b) => { b.disabled = false; });
  }
}, true);