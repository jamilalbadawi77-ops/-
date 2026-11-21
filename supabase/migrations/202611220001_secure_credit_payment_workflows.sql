-- Additive hardening migration: does not delete or rewrite existing user records.

-- Make a new user's trial award configurable; default 0 avoids silently inventing a commercial grant.
insert into public.app_settings(key,value)
values ('trial_credits','{"credits":0}'::jsonb)
on conflict (key) do nothing;

alter table public.payment_requests
  add column if not exists snapshot_credits integer,
  add column if not exists snapshot_duration_days integer;

-- Restrict direct profile edits to user-controlled display fields. Role, status and plan
-- changes must be implemented through server-side administrative procedures.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;

-- Keep the owner's existing read/insert behavior and grant administrators review access.
drop policy if exists payment_requests_admin_all on public.payment_requests;
create policy payment_requests_admin_all on public.payment_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_trial integer := 0;
begin
  insert into public.profiles(id,display_name)
    values(new.id,coalesce(new.raw_user_meta_data->>'display_name','')) on conflict(id) do nothing;
  insert into public.wallets(user_id,balance) values(new.id,0) on conflict(user_id) do nothing;

  select coalesce(nullif(value->>'credits','')::integer,0) into v_trial
    from public.app_settings where key='trial_credits';
  v_trial := greatest(coalesce(v_trial,0),0);
  if v_trial > 0 then
    insert into public.credit_transactions(user_id,amount,reason,idempotency_key)
      values(new.id,v_trial,'trial_signup','trial:'||new.id::text)
      on conflict(idempotency_key) do nothing;
    if found then
      update public.wallets set balance=balance+v_trial,updated_at=now() where user_id=new.id;
    end if;
  end if;
  return new;
end; $$;

-- Atomically reserve credits and create one project for a user/key pair. A retry returns
-- the original project; a failed insert rolls back the debit with the transaction.
create or replace function public.reserve_generation(
  p_user_id uuid, p_title text, p_service text, p_amount integer,
  p_key text, p_input jsonb default '{}'::jsonb
) returns table(project_id uuid,reused boolean,project_status text,result_url text,error_message text,insufficient boolean)
language plpgsql security definer set search_path=public as $$
declare v_project public.projects%rowtype; v_debit boolean; v_tx_key text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null or p_key is null or length(p_key)<8 or length(p_key)>120
     or p_amount is null or p_amount<0 or coalesce(length(trim(p_service)),0)=0 then
    raise exception 'invalid generation request';
  end if;
  v_tx_key := 'debit:'||p_user_id::text||':'||p_key;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_key,0));

  select * into v_project from public.projects
    where user_id=p_user_id and idempotency_key=p_key limit 1;
  if found then
    return query select v_project.id,true,v_project.status,v_project.result_url,v_project.error_message,false;
    return;
  end if;
  if exists(select 1 from public.credit_transactions where idempotency_key=v_tx_key) then
    raise exception 'idempotency key was already consumed';
  end if;

  v_debit := public.debit_credits(p_user_id,p_amount,p_service,v_tx_key);
  if not v_debit then
    return query select null::uuid,false,'failed'::text,null::text,'Insufficient credits'::text,true;
    return;
  end if;
  insert into public.projects(user_id,title,service,status,input,idempotency_key)
    values(p_user_id,left(coalesce(nullif(trim(p_title),''),p_service),90),p_service,'processing',coalesce(p_input,'{}'::jsonb),p_key)
    returning * into v_project;
  return query select v_project.id,false,v_project.status,v_project.result_url,v_project.error_message,false;
end; $$;
revoke all on function public.reserve_generation(uuid,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_generation(uuid,text,text,integer,text,jsonb) to service_role;

-- Snapshot a selected plan's price and entitlement at request time, and prevent users
-- from writing review state or submitting a mismatched amount.
create or replace function public.guard_payment_request_insert()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_plan public.plans%rowtype;
begin
  if auth.uid() is distinct from new.user_id and auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if new.status <> 'pending' or new.reviewed_by is not null or new.reviewed_at is not null then
    raise exception 'payment request must be pending';
  end if;
  if new.payment_method not in ('kareemi','flusak','other') then raise exception 'invalid payment method'; end if;
  if new.receipt_path is null or new.receipt_path not like new.user_id::text||'/payment-receipts/%' then
    raise exception 'owned payment receipt required';
  end if;
  select * into v_plan from public.plans where id=new.plan_id and is_active=true;
  if not found then raise exception 'active plan required'; end if;
  if round(new.amount,2) <> round(v_plan.price,2) then raise exception 'payment amount does not match plan'; end if;
  new.snapshot_credits := v_plan.credits;
  new.snapshot_duration_days := v_plan.duration_days;
  return new;
end; $$;
drop trigger if exists payment_request_guard on public.payment_requests;
create trigger payment_request_guard before insert on public.payment_requests
  for each row execute function public.guard_payment_request_insert();

create or replace function public.admin_review_payment(
  p_request_id uuid, p_approved boolean, p_note text default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_req public.payment_requests%rowtype; v_rows integer;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if p_approved is null then raise exception 'approval decision required'; end if;
  if p_approved is false and coalesce(length(trim(p_note)),0)=0 then raise exception 'rejection reason required'; end if;
  select * into v_req from public.payment_requests where id=p_request_id for update;
  if not found then raise exception 'payment request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'payment request already reviewed'; end if;

  if p_approved then
    if v_req.plan_id is null or v_req.snapshot_credits is null or v_req.snapshot_duration_days is null then
      raise exception 'payment request has no valid plan snapshot';
    end if;
    insert into public.wallets(user_id,balance) values(v_req.user_id,0) on conflict(user_id) do nothing;
    if v_req.snapshot_credits > 0 then
      insert into public.credit_transactions(user_id,amount,reason,reference_id,idempotency_key)
        values(v_req.user_id,v_req.snapshot_credits,'payment_approved',v_req.id,'payment:'||v_req.id::text)
        on conflict(idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then raise exception 'payment credit already granted'; end if;
      update public.wallets set balance=balance+v_req.snapshot_credits,updated_at=now() where user_id=v_req.user_id;
    end if;
    insert into public.subscriptions(user_id,plan_id,status,starts_at,ends_at)
      values(v_req.user_id,v_req.plan_id,'active',now(),now()+make_interval(days=>v_req.snapshot_duration_days));
    update public.payment_requests set status='approved',review_note=nullif(trim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now() where id=v_req.id;
    insert into public.notifications(user_id,title,body)
      values(v_req.user_id,'Payment approved','Your payment was approved and the plan was activated.');
  else
    update public.payment_requests set status='rejected',review_note=left(trim(p_note),1000),reviewed_by=auth.uid(),reviewed_at=now() where id=v_req.id;
    insert into public.notifications(user_id,title,body)
      values(v_req.user_id,'Payment rejected',left(trim(p_note),1000));
  end if;
  insert into public.admin_logs(actor_id,action,target_user_id,details)
    values(auth.uid(),case when p_approved then 'payment_approved' else 'payment_rejected' end,v_req.user_id,
      jsonb_build_object('request_id',v_req.id,'amount',v_req.amount,'plan_id',v_req.plan_id,'note',p_note));
end; $$;
revoke all on function public.admin_review_payment(uuid,boolean,text) from public,anon;
grant execute on function public.admin_review_payment(uuid,boolean,text) to authenticated;
