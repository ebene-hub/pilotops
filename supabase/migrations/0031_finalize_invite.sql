-- Robustly finalize an invited member's onboarding on first sign-in.
--
-- The old client flow accepted the invite via accept_invite(token), where the
-- token was held in the browser (and, after we added email confirmation, stashed
-- in user_metadata across the confirm round-trip). That is fragile: if the token
-- is lost (e.g. a duplicate signUp that doesn't refresh metadata) the invite is
-- never accepted, so the member gets no org/roles and the admin's invite stays
-- "pending" forever.
--
-- finalize_my_invite() instead finds the pending invite by the SIGNED-IN user's
-- email (read from auth.users, so it works under security definer) and accepts it.
-- Idempotent: safe to call on every sign-in / app load — returns accepted:false
-- when there's nothing to do.
create or replace function finalize_my_invite()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v      invites;
  uid    uuid := auth.uid();
  em     text;
begin
  if uid is null then
    return jsonb_build_object('accepted', false, 'reason', 'no-uid');
  end if;

  -- Read the email from public.profiles (created for every user at signup) and
  -- the JWT — NOT auth.users, which the definer role may not be able to read.
  select email into em from profiles where id = uid;
  if em is null then em := auth.jwt() ->> 'email'; end if;
  if em is null then
    return jsonb_build_object('accepted', false, 'reason', 'no-email');
  end if;

  select * into v from invites
    where lower(email) = lower(em)
      and status not in ('accepted', 'revoked')
      and (expires_at is null or expires_at > now())
    order by created_at desc
    limit 1;

  if v.id is null then
    return jsonb_build_object('accepted', false, 'reason', 'no-invite', 'email', em);
  end if;

  -- Accept + place into org first. These must not be rolled back by a later
  -- role-assignment hiccup, so the role insert runs in its own sub-block.
  update invites set status = 'accepted', accepted_at = now() where id = v.id;
  update profiles set org_id = v.org_id where id = uid and org_id is null;

  begin
    insert into member_roles (profile_id, role_id, org_id)
      select uid, r.id, v.org_id
        from roles r
       where r.name in (select jsonb_array_elements_text(v.roles))
    on conflict do nothing;
  exception when others then
    raise warning 'finalize_my_invite: role insert failed: %', sqlerrm;
  end;

  return jsonb_build_object('accepted', true, 'org', v.org_id, 'roles', v.roles);
end; $$;

grant execute on function finalize_my_invite() to authenticated;
