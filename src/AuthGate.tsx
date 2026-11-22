import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { supabase } from './lib/supabase';

type Mode = 'signin' | 'signup' | 'verify' | 'forgot' | 'reset';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const attemptsKey = (email: string) => `jamil-auth-attempts:${email.trim().toLowerCase()}`;
function getLockUntil(email: string): number {
  try { return Number(JSON.parse(localStorage.getItem(attemptsKey(email)) || '{}').lockedUntil) || 0; }
  catch { return 0; }
}

const ar = {
  title:'JAMIL AI', signIn:'تسجيل الدخول', signUp:'إنشاء حساب جديد', name:'الاسم', email:'البريد الإلكتروني', password:'كلمة المرور', newPassword:'كلمة المرور الجديدة', code:'رمز التحقق', continue:'دخول', create:'إنشاء الحساب وإرسال الرمز', verify:'تأكيد البريد الإلكتروني', back:'العودة لتسجيل الدخول', haveAccount:'لديك حساب؟ تسجيل الدخول', noAccount:'ليس لديك حساب؟ أنشئ حسابًا جديدًا', resend:'إعادة إرسال الرمز', checkEmail:'أرسلنا رمز تحقق إلى بريدك. أدخله لإكمال إنشاء الحساب.', forgot:'نسيت كلمة المرور؟', sendReset:'إرسال رابط الاستعادة', resetTitle:'استعادة كلمة المرور', resetButton:'حفظ كلمة المرور الجديدة', resetSent:'إذا كان البريد مسجلًا، ستصلك رسالة تحتوي على رابط استعادة كلمة المرور.', resetDone:'تم تغيير كلمة المرور. سجّل الدخول بكلمتك الجديدة.', locked:'محاولات كثيرة. حاول مجددًا بعد', minutes:'دقيقة', seconds:'ثانية', missingConfig:'إعدادات Supabase غير مكتملة. أضف عنوان المشروع والمفتاح العام.', genericError:'تعذر إكمال الطلب. تحقق من البيانات وإعدادات البريد في Supabase.',
};
const en = {
  title:'JAMIL AI', signIn:'Sign in', signUp:'Create a new account', name:'Name', email:'Email address', password:'Password', newPassword:'New password', code:'Verification code', continue:'Sign in', create:'Create account and send code', verify:'Verify email', back:'Back to sign in', haveAccount:'Already have an account? Sign in', noAccount:"Don't have an account? Create one", resend:'Resend code', checkEmail:'We sent a verification code to your email. Enter it to finish creating your account.', forgot:'Forgot password?', sendReset:'Send recovery link', resetTitle:'Reset password', resetButton:'Save new password', resetSent:'If the email is registered, a password recovery link will arrive shortly.', resetDone:'Password changed. Sign in with your new password.', locked:'Too many attempts. Try again in', minutes:'min', seconds:'sec', missingConfig:'Supabase is not configured. Add the project URL and public key.', genericError:'Could not complete the request. Check your details and Supabase email settings.',
};

export default function AuthGate() {
  const recovery = new URLSearchParams(window.location.search).has('reset-password');
  const [mode, setMode] = useState<Mode>(recovery ? 'reset' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [clock, setClock] = useState(Date.now());
  const rtl = document.documentElement.lang !== 'en';
  const t = rtl ? ar : en;
  const lockedUntil = mode === 'signin' ? getLockUntil(email) : 0;
  const remaining = Math.max(0, lockedUntil - clock);
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [remaining > 0]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) { setMessage(t.missingConfig); return; }
    if (mode === 'signin' && getLockUntil(email) > Date.now()) { setClock(Date.now()); return; }
    setBusy(true); setMessage('');
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email:email.trim(), password, options:{ data:{ display_name:name.trim() }, emailRedirectTo:window.location.origin } });
        if (error) throw error;
        if (data.session) return;
        setMode('verify'); setMessage(t.checkEmail); return;
      }
      if (mode === 'verify') {
        const { error } = await supabase.auth.verifyOtp({ email:email.trim(), token:code.trim(), type:'signup' });
        if (error) throw error;
        return;
      }
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo:`${window.location.origin}/?reset-password=1` });
        if (error) throw error;
        setMode('signin'); setMessage(t.resetSent); return;
      }
      if (mode === 'reset') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMessage(t.resetDone); history.replaceState(null, '', '/'); setMode('signin'); return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email:email.trim(), password });
      if (error) {
        const key = attemptsKey(email);
        let attempts = 0;
        try { attempts = Number(JSON.parse(localStorage.getItem(key) || '{}').count) || 0; } catch { /* use fresh attempt count */ }
        attempts += 1;
        const lockedUntil = attempts >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0;
        localStorage.setItem(key, JSON.stringify({ count:lockedUntil ? 0 : attempts, lockedUntil }));
        if (lockedUntil) setMessage(rtl ? 'تم إيقاف المحاولات مؤقتًا لمدة 15 دقيقة بسبب كثرة المحاولات.' : 'Sign-in is paused for 15 minutes after too many attempts.');
        else throw error;
        return;
      }
      localStorage.removeItem(attemptsKey(email));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.genericError);
    } finally { setBusy(false); setClock(Date.now()); }
  }

  async function resend() {
    if (!supabase) return;
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.resend({ type:'signup', email:email.trim() });
    setMessage(error?.message ?? t.checkEmail); setBusy(false);
  }

  const field: CSSProperties = { width:'100%', boxSizing:'border-box', padding:'15px 16px', marginTop:8, borderRadius:14, border:'1px solid #302d55', background:'#090817', color:'#f7f6ff', fontSize:17, outlineColor:'#7446ff' };
  const button: CSSProperties = { width:'100%', padding:15, marginTop:18, border:0, borderRadius:14, background:'linear-gradient(100deg,#7446ff,#315bff)', color:'white', fontSize:17, fontWeight:700, cursor:'pointer' };
  const title = mode === 'signup' ? t.signUp : mode === 'verify' ? t.verify : mode === 'forgot' ? t.resetTitle : mode === 'reset' ? t.resetTitle : t.signIn;
  const lockText = `${t.locked} ${Math.ceil(remaining / 60000)} ${t.minutes} ${Math.ceil((remaining % 60000) / 1000)} ${t.seconds}`;

  return <main dir={rtl?'rtl':'ltr'} style={{ minHeight:'100vh', display:'grid', placeItems:'center', padding:20, boxSizing:'border-box', background:'#090817', color:'#f7f6ff', fontFamily:'Tajawal, sans-serif' }}>
    <form onSubmit={submit} style={{ width:'min(100%,520px)', boxSizing:'border-box', padding:'clamp(24px,7vw,48px)', border:'1px solid #302d55', borderRadius:28, background:'#12112a', boxShadow:'0 24px 80px #0006' }}>
      <h1 style={{ textAlign:'center', fontSize:30, margin:'0 0 12px' }}>{t.title}</h1><h2 style={{ textAlign:'center', fontSize:25, margin:'0 0 24px' }}>{title}</h2>
      {mode === 'signup' && <label style={{ display:'block', marginTop:14 }}>{t.name}<input style={field} autoComplete="name" required value={name} onChange={e=>setName(e.target.value)} /></label>}
      {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && <label style={{ display:'block', marginTop:14 }}>{t.email}<input style={field} type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>}
      {(mode === 'signin' || mode === 'signup' || mode === 'reset') && <label style={{ display:'block', marginTop:14 }}>{mode === 'reset' ? t.newPassword : t.password}<input style={field} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} /></label>}
      {mode === 'verify' && <label style={{ display:'block', marginTop:14 }}>{t.code}<input style={field} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value)} /></label>}
      {remaining > 0 && <p role="alert" style={{ color:'#ffb4b4' }}>{lockText}</p>}
      {message && <p role="status" style={{ color:'#d6c9ff', lineHeight:1.6 }}>{message}</p>}
      <button style={{ ...button, opacity:busy||remaining>0?.65:1 }} disabled={busy||remaining>0}>{busy?'…':mode==='signup'?t.create:mode==='verify'?t.verify:mode==='forgot'?t.sendReset:mode==='reset'?t.resetButton:t.continue}</button>
      {mode === 'signin' && <button type="button" onClick={()=>{setMessage('');setMode('forgot');}} style={{ display:'block', width:'100%', marginTop:12, padding:8, border:0, background:'transparent', color:'#a98bff', fontSize:15, cursor:'pointer' }}>{t.forgot}</button>}
      {mode === 'verify' && <button type="button" onClick={resend} disabled={busy} style={{ ...button, marginTop:10, background:'transparent', border:'1px solid #514b83' }}>{t.resend}</button>}
      {(mode === 'signup' || mode === 'signin' || mode === 'forgot') && <button type="button" onClick={()=>{setMessage('');setMode(mode==='signup'?'signin':mode==='signin'?'signup':'signin');}} style={{ display:'block', width:'100%', marginTop:16, padding:8, border:0, background:'transparent', color:'#a98bff', fontSize:15, cursor:'pointer' }}>{mode==='signup'?t.haveAccount:mode==='signin'?t.noAccount:t.back}</button>}
      {(mode === 'verify' || mode === 'reset') && <button type="button" onClick={()=>{setMessage('');setMode('signin');history.replaceState(null,'','/');}} style={{ display:'block', width:'100%', marginTop:12, padding:8, border:0, background:'transparent', color:'#a98bff', fontSize:15, cursor:'pointer' }}>{t.back}</button>}
    </form>
  </main>;
}
