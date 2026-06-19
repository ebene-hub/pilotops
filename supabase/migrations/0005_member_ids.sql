-- Pilot Ops — human-readable member IDs + a flag for "pilot code is set".
-- The 6-digit code itself stays hashed and unreadable; admins can see THAT a
-- code exists and reset it (revealed once), but never read the existing one.

create sequence if not exists member_short_seq start 1;

alter table profiles add column if not exists short_id text;
update profiles set short_id = 'PT-' || lpad(nextval('member_short_seq')::text, 4, '0')
  where short_id is null;
alter table profiles alter column short_id set default ('PT-' || lpad(nextval('member_short_seq')::text, 4, '0'));

alter table profiles add column if not exists pilot_code_set boolean not null default false;

-- expose the two new (safe) columns to authenticated clients
grant select (short_id, pilot_code_set) on profiles to authenticated;

-- set_pilot_code also records that a code now exists
create or replace function set_pilot_code(p_profile uuid, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (auth_is_admin() or auth.uid() = p_profile) then raise exception 'not authorized'; end if;
  if p_code !~ '^[0-9]{6}$' then raise exception 'code must be 6 digits'; end if;
  update profiles set pilot_code_hash = crypt(p_code, gen_salt('bf')), pilot_code_set = true where id = p_profile;
end; $$;

-- Admin helper: replace a member's roles in one call (delete + insert).
create or replace function set_member_roles(p_profile uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not auth_is_admin() then raise exception 'not authorized'; end if;
  delete from member_roles where profile_id = p_profile;
  insert into member_roles(profile_id, role_id)
    select p_profile, r.id from roles r where r.name = any(p_roles)
  on conflict do nothing;
end; $$;
grant execute on function set_member_roles(uuid, text[]) to authenticated;
