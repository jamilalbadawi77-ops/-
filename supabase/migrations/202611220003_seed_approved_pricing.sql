-- Approved launch pricing. Existing named plans are preserved; this migration does not overwrite them.
with trial_update as (
  update public.app_settings s
  set value='{"credits":300}'::jsonb, updated_at=now()
  where s.ctid=(select ctid from public.app_settings where key='trial_credits' limit 1)
  returning key
), unit_setting as (
  insert into public.app_settings(key,value)
  select 'credit_unit','{"currency":"USD","points_per_usd":1000}'::jsonb limit 1
  on conflict(key) do update set value=excluded.value, updated_at=now()
  returning key
), plan_seed as (
  insert into public.plans(name,price,credits,duration_days,features,is_active)
  select v.name,v.price,v.credits,30,v.features,true
  from (values
    ('أساسية / Starter',5::numeric,4500,'{"billing_currency":"USD","cadence":"monthly","points_expire":"period_end"}'::jsonb),
    ('احترافية / Pro',12::numeric,12000,'{"billing_currency":"USD","cadence":"monthly","points_expire":"period_end"}'::jsonb),
    ('أعمال / Business',25::numeric,27500,'{"billing_currency":"USD","cadence":"monthly","points_expire":"period_end"}'::jsonb)
  ) as v(name,price,credits,features)
  where not exists (select 1 from public.plans p where p.name=v.name limit 1)
  returning id
), service_targets as (
  select ctid,service from public.service_settings
  where service in ('chat','image','tts') order by service limit 3
), service_update as (
  update public.service_settings s
  set enabled=false,
      credit_cost=case s.service when 'chat' then 35 when 'image' then 200 when 'tts' then 180 end,
      limits=coalesce(s.limits,'{}'::jsonb) || case s.service
        when 'chat' then '{"billing_ready":false,"currency":"USD","pricing":{"type":"per_1000_tokens","input_points":5,"output_points":25},"unit":"per 1000 input/output tokens"}'::jsonb
        when 'image' then '{"billing_ready":false,"currency":"USD","pricing":{"type":"per_image","points":200,"size":"1024x1024","quality":"standard"},"model":"gpt-image-2.6-sunburst"}'::jsonb
        when 'tts' then '{"billing_ready":false,"currency":"USD","pricing":{"type":"per_1000_characters","turbo_points":100,"multilingual_points":180},"unit":"per 1000 characters"}'::jsonb
      end,
      updated_at=now()
  from service_targets t where s.ctid=t.ctid
  returning s.service
)
select (select count(*) from trial_update) as trial_setting_updated,
       (select count(*) from unit_setting) as credit_unit_setting_written,
       (select count(*) from plan_seed) as plans_inserted,
       (select count(*) from service_update) as services_configured limit 1;
