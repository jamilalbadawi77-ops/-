import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, ExternalLink, RefreshCw, Shield, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Row = Record<string, any>;
export default function AdminConsole({ allowed, lang }: { allowed: boolean; lang: 'ar' | 'en' }) {
  const ar = lang === 'ar';
  const [stats, setStats] = useState({ users: 0, pending: 0, subscriptions: 0, generations: 0 });
  const [payments, setPayments] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Row[]>([]);
  const [services, setServices] = useState<Row[]>([]);
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ name: '', price: '', credits: '', days: '30' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase || !allowed) return;
    const client = supabase;
    setError('');
    const [u,p,s,g,pay,plan,srv] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('payment_requests').select('id', { count: 'exact', head: true }).eq('status','pending'),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status','active'),
      supabase.from('generations').select('id', { count: 'exact', head: true }),
      supabase.from('payment_requests').select('id,user_id,plan_id,amount,payment_method,transaction_reference,receipt_path,created_at').eq('status','pending').order('created_at'),
      supabase.from('plans').select('id,name,price,credits,duration_days,is_active').order('created_at',{ascending:false}),
      supabase.from('service_settings').select('service,enabled,credit_cost').order('service'),
    ]);
    const firstError = u.error || p.error || s.error || g.error || pay.error || plan.error || srv.error;
    if (firstError) { setError(firstError.message); return; }
    setStats({ users: u.count || 0, pending: p.count || 0, subscriptions: s.count || 0, generations: g.count || 0 });
    setPayments(pay.data || []); setPlans(plan.data || []); setServices(srv.data || []);
    const urls: Record<string,string> = {};
    await Promise.all((pay.data || []).map(async (item: Row) => {
      if (!item.receipt_path) return;
      const result = await client.storage.from('user-files').createSignedUrl(item.receipt_path, 900);
      if (result.data?.signedUrl) urls[item.id] = result.data.signedUrl;
    }));
    setReceiptUrls(urls);
  }, [allowed]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function review(id: string, approved: boolean) {
    if (!supabase) return;
    if (!approved && !note[id]?.trim()) { setError(ar ? 'اكتب سبب الرفض أولًا.' : 'Enter a rejection reason first.'); return; }
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('admin_review_payment', { p_request_id: id, p_approved: approved, p_note: note[id]?.trim() || null });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNote((current) => ({ ...current, [id]: '' })); await refresh();
  }
  async function addPlan(e: FormEvent) {
    e.preventDefault(); if (!supabase) return;
    const price = Number(draft.price), credits = Number(draft.credits), days = Number(draft.days);
    if (!draft.name.trim() || !Number.isFinite(price) || price < 0 || !Number.isInteger(credits) || credits < 0 || !Number.isInteger(days) || days < 1) { setError(ar ? 'راجع بيانات الخطة.' : 'Check the plan fields.'); return; }
    setBusy(true); const { error: insertError } = await supabase.from('plans').insert({ name: draft.name.trim(), price, credits, duration_days: days, features: [], is_active: true }); setBusy(false);
    if (insertError) setError(insertError.message); else { setDraft({ name:'', price:'', credits:'', days:'30' }); await refresh(); }
  }
  async function togglePlan(id: string, active: boolean) {
    if (!supabase) return; setBusy(true); const { error: updateError } = await supabase.from('plans').update({ is_active: active }).eq('id', id); setBusy(false);
    if (updateError) setError(updateError.message); else await refresh();
  }
  async function updateService(service: string, patch: Partial<Row>) {
    if (!supabase) return; setBusy(true); const { error: updateError } = await supabase.from('service_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('service', service); setBusy(false);
    if (updateError) setError(updateError.message); else await refresh();
  }

  if (!allowed) return <div className="panel denied"><Shield size={38}/><h2>{ar ? 'هذه الصفحة متاحة للمديرين المخولين فقط.' : 'This page is restricted to authorized admins.'}</h2></div>;
  return <div className="admin-console"><div className="page-heading"><div><span className="eyebrow">JAMIL AI · ADMIN</span><h1>{ar ? 'لوحة الإدارة' : 'Administration'}</h1><p>{ar ? 'تغييرات حقيقية محفوظة في Supabase؛ الوصول يتحقق من دور المستخدم.' : 'Live Supabase data; authorization is checked by role and RLS.'}</p></div><button className="outline" onClick={() => void refresh()}><RefreshCw size={16}/>{ar ? 'تحديث' : 'Refresh'}</button></div>
    {error && <div className="panel form-message error" role="alert">{error}</div>}
    <div className="stats-grid admin-stats">{[[ar?'المستخدمون':'Users',stats.users],[ar?'مدفوعات معلقة':'Pending payments',stats.pending],[ar?'اشتراكات نشطة':'Active subscriptions',stats.subscriptions],[ar?'عمليات مسجلة':'Generations',stats.generations]].map(([label,value]) => <div className="stat-card blue" key={String(label)}><div className="stat-icon"><Shield size={19}/></div><div><small>{label}</small><strong>{value}</strong></div></div>)}</div>
    <section className="panel admin-section"><h3>{ar ? 'طلبات الدفع قيد المراجعة' : 'Payment requests awaiting review'}</h3>{payments.length ? payments.map((payment) => <div className="admin-payment" key={payment.id}><div className="admin-payment-info"><b>{payment.amount} · {payment.payment_method}</b><small>{ar ? 'مستخدم' : 'User'}: {payment.user_id}</small><small>{payment.transaction_reference || '—'} · {new Date(payment.created_at).toLocaleString(ar ? 'ar' : 'en')}</small>{receiptUrls[payment.id] && <a href={receiptUrls[payment.id]} target="_blank" rel="noreferrer" className="outline"><ExternalLink size={14}/>{ar ? 'فتح الإيصال' : 'Open receipt'}</a>}<input placeholder={ar ? 'سبب الرفض عند الرفض' : 'Reason if rejecting'} value={note[payment.id] || ''} onChange={(e) => setNote({ ...note, [payment.id]: e.target.value })}/></div><div className="admin-actions"><button className="primary" disabled={busy} onClick={() => void review(payment.id,true)}><Check size={15}/>{ar ? 'اعتماد' : 'Approve'}</button><button className="outline danger" disabled={busy} onClick={() => void review(payment.id,false)}><X size={15}/>{ar ? 'رفض' : 'Reject'}</button></div></div>) : <div className="empty">{ar ? 'لا توجد طلبات معلقة.' : 'No pending requests.'}</div>}</section>
    <section className="panel admin-section"><h3>{ar ? 'الخطط' : 'Plans'}</h3><form className="admin-plan-form" onSubmit={addPlan}><input required placeholder={ar?'اسم الخطة':'Plan name'} value={draft.name} onChange={(e) => setDraft({...draft,name:e.target.value})}/><input required type="number" min="0" step="0.01" placeholder={ar?'السعر':'Price'} value={draft.price} onChange={(e) => setDraft({...draft,price:e.target.value})}/><input required type="number" min="0" placeholder={ar?'النقاط':'Credits'} value={draft.credits} onChange={(e) => setDraft({...draft,credits:e.target.value})}/><input required type="number" min="1" placeholder={ar?'الأيام':'Days'} value={draft.days} onChange={(e) => setDraft({...draft,days:e.target.value})}/><button className="primary" disabled={busy}>{ar ? 'إضافة خطة' : 'Add plan'}</button></form>{plans.map((plan) => <div className="admin-plan-row" key={plan.id}><b>{plan.name}</b><span>{plan.price} · {plan.credits} · {plan.duration_days} {ar ? 'يوم' : 'days'}</span><button className="outline" disabled={busy} onClick={() => void togglePlan(plan.id,!plan.is_active)}>{plan.is_active ? (ar?'إيقاف':'Disable') : (ar?'تفعيل':'Enable')}</button></div>)}</section>
    <section className="panel admin-section"><h3>{ar ? 'إعداد الخدمات والأسعار' : 'Service availability and prices'}</h3>{services.map((service) => <div className="admin-service-row" key={service.service}><b>{service.service}</b><input aria-label={`${service.service} credits`} type="number" min="0" defaultValue={service.credit_cost} onBlur={(e) => { if (Number(e.target.value) !== service.credit_cost) void updateService(service.service,{credit_cost:Number(e.target.value)}); }}/><button className={`toggle ${service.enabled ? 'on' : ''}`} disabled={busy} onClick={() => void updateService(service.service,{enabled:!service.enabled})}>{service.enabled ? (ar?'مفعلة':'Enabled') : (ar?'متوقفة':'Disabled')}</button></div>)}</section>
  </div>;
}
