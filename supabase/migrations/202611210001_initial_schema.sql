create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active','suspended')),
  current_plan text not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','user')),
  created_at timestamptz not null default now(),
  primary key(user_id,role)
);
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(), name text not null, price numeric(12,2) not null default 0 check(price>=0),
  credits integer not null default 0 check(credits>=0), duration_days integer not null default 30 check(duration_days>0),
  features jsonb not null default '[]', is_active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check(balance>=0), updated_at timestamptz not null default now()
);
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check(amount<>0), reason text not null, reference_id uuid, idempotency_key text unique,
  created_at timestamptz not null default now()
);
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null, status text not null default 'pending' check(status in ('pending','active','expired','cancelled')),
  starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null, amount numeric(12,2) not null check(amount>0),
  payment_method text not null, transaction_reference text, receipt_path text, status text not null default 'pending' check(status in ('pending','approved','rejected')),
  review_note text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, service text not null, status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  input jsonb not null default '{}', result_url text, error_message text, idempotency_key text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,idempotency_key)
);
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, service text not null,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  provider_job_id text, cost integer not null default 0, error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id), action text not null,
  target_user_id uuid references auth.users(id), details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.service_settings (
  service text primary key, enabled boolean not null default false, credit_cost integer not null default 0 check(credit_cost>=0),
  limits jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists public.voice_clones (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  provider_voice_id text not null, name text not null, consent_confirmed boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.chat_history (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat', messages jsonb not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.app_settings (key text primary key, value jsonb not null default '{}', updated_at timestamptz not null default now());

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin'); $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare trial_credits integer := 0;
begin
 insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','')) on conflict(id) do nothing;
 insert into public.wallets(user_id,balance) values(new.id,0) on conflict(user_id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.debit_credits(p_user_id uuid,p_amount integer,p_service text,p_key text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null and auth.uid()<>p_user_id and not public.is_admin() then raise exception 'forbidden'; end if;
 if p_amount<0 or p_key is null or length(p_key)<8 then raise exception 'invalid debit'; end if;
 if exists(select 1 from public.credit_transactions where idempotency_key=p_key) then return true; end if;
 update public.wallets set balance=balance-p_amount,updated_at=now() where user_id=p_user_id and balance>=p_amount;
 if not found then return false; end if;
 insert into public.credit_transactions(user_id,amount,reason,idempotency_key) values(p_user_id,-p_amount,p_service,p_key);
 return true;
end; $$;
create or replace function public.refund_credits(p_user_id uuid,p_amount integer,p_reason text,p_key text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_amount<=0 then raise exception 'invalid refund'; end if;
 if exists(select 1 from public.credit_transactions where idempotency_key=p_key) then return; end if;
 update public.wallets set balance=balance+p_amount,updated_at=now() where user_id=p_user_id;
 insert into public.credit_transactions(user_id,amount,reason,idempotency_key) values(p_user_id,p_amount,p_reason,p_key);
end; $$;
revoke all on function public.debit_credits(uuid,integer,text,text) from public;
revoke all on function public.refund_credits(uuid,integer,text,text) from public;
grant execute on function public.debit_credits(uuid,integer,text,text) to authenticated, service_role;
grant execute on function public.refund_credits(uuid,integer,text,text) to service_role;

create or replace view public.admin_dashboard_stats with (security_invoker=true) as
 select (select count(*) from auth.users) as users,
 (select count(*) from public.payment_requests where status='pending') as pending_payments,
 (select count(*) from public.subscriptions where status='active' and ends_at>now()) as active_subscriptions,
 (select count(*) from public.generations) as generations;

alter table public.profiles enable row level security; alter table public.user_roles enable row level security;
alter table public.plans enable row level security; alter table public.wallets enable row level security;
alter table public.credit_transactions enable row level security; alter table public.subscriptions enable row level security;
alter table public.payment_requests enable row level security; alter table public.projects enable row level security;
alter table public.generations enable row level security; alter table public.notifications enable row level security;
alter table public.admin_logs enable row level security; alter table public.service_settings enable row level security;
alter table public.voice_clones enable row level security; alter table public.chat_history enable row level security;
alter table public.app_settings enable row level security;

do $$ declare t text; owner_column text; begin
 foreach t in array array['profiles','wallets','credit_transactions','subscriptions','payment_requests','projects','generations','notifications','voice_clones','chat_history'] loop
  owner_column := case when t='profiles' then 'id' else 'user_id' end;
  execute format('drop policy if exists owner_select on public.%I',t);
  execute format('create policy owner_select on public.%I for select to authenticated using (%I=auth.uid() or public.is_admin())',t,owner_column);
 end loop;
end $$;
drop policy if exists profile_update_own on public.profiles;
create policy profile_update_own on public.profiles for update to authenticated using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());
drop policy if exists role_read_own on public.user_roles;
create policy role_read_own on public.user_roles for select to authenticated using(user_id=auth.uid() or public.is_admin());
drop policy if exists plans_read_active on public.plans;
create policy plans_read_active on public.plans for select to anon,authenticated using(is_active or public.is_admin());
drop policy if exists plans_admin_all on public.plans;
create policy plans_admin_all on public.plans for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists service_read_enabled on public.service_settings;
create policy service_read_enabled on public.service_settings for select to authenticated using(enabled or public.is_admin());
drop policy if exists service_admin_all on public.service_settings;
create policy service_admin_all on public.service_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists admin_logs_read on public.admin_logs;
create policy admin_logs_read on public.admin_logs for select to authenticated using(public.is_admin());
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using(true);
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists own_insert_projects on public.projects;
create policy own_insert_projects on public.projects for insert to authenticated with check(user_id=auth.uid());
drop policy if exists own_insert_payments on public.payment_requests;
create policy own_insert_payments on public.payment_requests for insert to authenticated with check(user_id=auth.uid() and status='pending');
drop policy if exists own_update_notifications on public.notifications;
create policy own_update_notifications on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists own_insert_chat on public.chat_history;
create policy own_insert_chat on public.chat_history for insert to authenticated with check(user_id=auth.uid());
drop policy if exists own_update_chat on public.chat_history;
create policy own_update_chat on public.chat_history for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists own_delete_projects on public.projects;
create policy own_delete_projects on public.projects for delete to authenticated using(user_id=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('user-files','user-files',false,52428800,array['image/png','image/jpeg','image/webp','audio/mpeg','audio/wav','audio/mp4','video/mp4','application/pdf'])
on conflict(id) do nothing;
drop policy if exists user_files_read on storage.objects;
create policy user_files_read on storage.objects for select to authenticated using(bucket_id='user-files' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists user_files_write on storage.objects;
create policy user_files_write on storage.objects for insert to authenticated with check(bucket_id='user-files' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists user_files_delete on storage.objects;
create policy user_files_delete on storage.objects for delete to authenticated using(bucket_id='user-files' and (storage.foldername(name))[1]=auth.uid()::text);
