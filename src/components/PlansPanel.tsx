import { useEffect, useState, type FormEvent } from 'react';
import { Coins, Crown, Upload, Wallet, Clock3 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Plan = { id: string; name: string; price: number; credits: number; duration_days: number; features: unknown };
type Payment = { id: string; amount: number; payment_method: string; transaction_reference: string | null; status: string; review_note: string | null; created_at: string };

export default function PlansPanel({ lang, userId }: { lang: 'ar' | 'en'; userId: string }) {
  const ar = lang === 'ar';
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState('');
  const [method, setMethod] = useState('kareemi');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    if (!supabase) return;
    setLoading(true);
    const [planResult, paymentResult] = await Promise.all([
      supabase.from('plans').select('id,name,price,credits,duration_days,features').eq('is_active', true).order('price'),
      supabase.from('payment_requests').select('id,amount,payment_method,transaction_reference,status,review_note,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    ]);
    if (planResult.error) setMessage(planResult.error.message);
    else setPlans(planResult.data || []);
    if (paymentResult.error) setMessage(paymentResult.error.message);
    else setPayments(paymentResult.data || []);
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, [userId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !selected) return;
    const plan = plans.find((item) => item.id === selected);
    if (!plan || !receipt) { setMessage(ar ? 'اختر خطة وارفع إيصال التحويل.' : 'Select a plan and upload a transfer receipt.'); return; }
    if (receipt.size > 50 * 1024 * 1024) { setMessage(ar ? 'حجم الإيصال يتجاوز 50MB.' : 'Receipt exceeds 50MB.'); return; }
    if (!['image/png','image/jpeg','image/webp','application/pdf'].includes(receipt.type)) { setMessage(ar ? 'الصيغ المقبولة: PNG أو JPG أو WEBP أو PDF.' : 'Accepted formats: PNG, JPG, WEBP or PDF.'); return; }
    setBusy(true); setMessage('');
    try {
      const clean = receipt.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'receipt';
      const path = `${userId}/payment-receipts/${crypto.randomUUID()}-${clean}`;
      const uploaded = await supabase.storage.from('user-files').upload(path, receipt, { contentType: receipt.type, upsert: false });
      if (uploaded.error) throw uploaded.error;
      const inserted = await supabase.from('payment_requests').insert({ user_id: userId, plan_id: plan.id, amount: plan.price, payment_method: method, transaction_reference: reference.trim() || null, receipt_path: path, status: 'pending' });
      if (inserted.error) {
        await supabase.storage.from('user-files').remove([path]);
        throw inserted.error;
      }
      setMessage(ar ? 'أُرسل الطلب، وسيظل الرصيد كما هو حتى يراجعه المدير.' : 'Request submitted. Credits remain unchanged until an administrator reviews it.');
      setReceipt(null); setReference(''); await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (ar ? 'تعذر إرسال الطلب.' : 'Could not submit the request.'));
    } finally { setBusy(false); }
  }

  const statusText = (status: string) => ar ? ({ pending: 'بانتظار المراجعة', approved: 'مقبول', rejected: 'مرفوض' }[status] || status) : status;
  return <div className="plans-page">
    <div className="page-heading"><div><span className="eyebrow">JAMIL AI</span><h1>{ar ? 'الخطط والمدفوعات' : 'Plans & payments'}</h1><p>{ar ? 'تُراجع التحويلات يدويًا؛ إرسال الإيصال لا يضيف رصيدًا.' : 'Transfers are manually reviewed; submitting a receipt does not add credits.'}</p></div></div>
    <div className="payment-note"><Wallet/><span><b>{ar ? 'حساب نقطة حاسب كريمي:' : 'Kareemi point account:'} 1299834<br/>{ar ? 'أرقام المحافظ:' : 'Wallet numbers:'} +967730528609 · +967782602676</b></span></div>
    {loading ? <div className="panel">{ar ? 'جارٍ تحميل بيانات الخطط…' : 'Loading live plans…'}</div> : plans.length ? <div className="plans-grid">{plans.map((plan) => <article className={`plan-card ${selected === plan.id ? 'selected' : ''}`} key={plan.id}>
      <div className="plan-top"><Crown size={20}/><span>{plan.duration_days} {ar ? 'يوم' : 'days'}</span></div>
      <h3>{plan.name}</h3><strong className="plan-price">{plan.price}</strong><small>{ar ? 'السعر' : 'Price'}</small>
      <p><Coins size={16}/> {plan.credits} {ar ? 'نقطة' : 'credits'}</p>
      <button className="primary wide" onClick={() => setSelected(plan.id)}>{ar ? 'اختيار الخطة' : 'Select plan'}</button>
    </article>)}</div> : <div className="panel"><div className="empty">{ar ? 'لا توجد خطط منشورة حاليًا.' : 'No published plans are available yet.'}</div></div>}
    {selected && <form className="panel payment-form" onSubmit={submit}>
      <h3>{ar ? 'إرسال طلب مراجعة الدفع' : 'Submit payment for review'}</h3>
      <label>{ar ? 'وسيلة الدفع' : 'Payment method'}<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="kareemi">Kareemi</option><option value="flusak">Flusak</option><option value="other">{ar ? 'محفظة أخرى' : 'Other wallet'}</option></select></label>
      <label>{ar ? 'رقم التحويل (اختياري)' : 'Transfer reference (optional)'}<input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120}/></label>
      <label className="upload-box"><Upload/>{receipt?.name || (ar ? 'رفع صورة الإيصال أو PDF' : 'Upload receipt image or PDF')}<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setReceipt(e.target.files?.[0] || null)}/></label>
      <button className="primary" disabled={busy || !receipt}>{busy ? (ar ? 'جارٍ الإرسال…' : 'Submitting…') : (ar ? 'إرسال للمراجعة' : 'Submit for review')}</button>
    </form>}
    {message && <div className="panel form-message" role="status">{message}</div>}
    <div className="panel payment-history"><h3>{ar ? 'طلبات الدفع السابقة' : 'Payment history'}</h3>{payments.length ? payments.map((payment) => <div className="project-row" key={payment.id}><Clock3 size={18}/><div className="project-info"><b>{payment.amount} · {payment.payment_method}</b><small>{new Date(payment.created_at).toLocaleString(ar ? 'ar' : 'en')}{payment.review_note ? ` · ${payment.review_note}` : ''}</small></div><span className={`status-chip ${payment.status}`}>{statusText(payment.status)}</span></div>) : <div className="empty">{ar ? 'لا توجد طلبات سابقة.' : 'No payment requests yet.'}</div>}</div>
  </div>;
}
