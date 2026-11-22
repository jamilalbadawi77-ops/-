import { useState, type FormEvent } from 'react';
import { supabase } from './lib/supabase';

type Mode = 'signin' | 'signup' | 'verify';

const ar = {
  title: 'JAMIL AI',
  signIn: 'تسجيل الدخول',
  signUp: 'إنشاء حساب جديد',
  name: 'الاسم',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  code: 'رمز التحقق',
  continue: 'متابعة',
  create: 'إنشاء الحساب وإرسال الرمز',
  verify: 'تأكيد البريد الإلكتروني',
  back: 'العودة لتسجيل الدخول',
  haveAccount: 'لديك حساب؟ تسجيل الدخول',
  noAccount: 'ليس لديك حساب؟ أنشئ حسابًا جديدًا',
  resend: 'إعادة إرسال الرمز',
  checkEmail: 'أرسلنا رمز تحقق إلى بريدك. أدخله لإكمال إنشاء الحساب.',
  missingConfig: 'إعدادات Supabase غير مكتملة. أضف عنوان المشروع والمفتاح العام.',
  genericError: 'تعذر إكمال الطلب. تحقق من البيانات وإعدادات البريد في Supabase.',
};
const en = {
  title: 'JAMIL AI', signIn: 'Sign in', signUp: 'Create a new account', name: 'Name', email: 'Email address', password: 'Password', code: 'Verification code', continue: 'Continue', create: 'Create account and send code', verify: 'Verify email', back: 'Back to sign in', haveAccount: 'Already have an account? Sign in', noAccount: "Don't have an account? Create one", resend: 'Resend code', checkEmail: 'We sent a verification code to your email. Enter it to finish creating your account.', missingConfig: 'Supabase is not configured. Add the project URL and public key.', genericError: 'Could not complete the request. Check your details and Supabase email settings.',
};

export default function AuthGate() {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const rtl = document.documentElement.lang !== 'en';
  const t = rtl ? ar : en;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) { setMessage(t.missingConfig); return; }
    setBusy(true); setMessage('');
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) return;
        setMode('verify');
        setMessage(t.checkEmail);
        return;
      }
      if (mode === 'verify') {
        const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch (error) {
      const detail = error instanceof Error ? error.message : t.genericError;
      setMessage(detail || t.genericError);
    } finally { setBusy(false); }
  }

  async function resend() {
    if (!supabase) return;
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    setMessage(error?.message ?? t.checkEmail);
    setBusy(false);
  }

  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '15px 16px', marginTop: 8, borderRadius: 14, border: '1px solid #302d55', background: '#090817', color: '#f7f6ff', fontSize: 17, outlineColor: '#7446ff' };
  const button: React.CSSProperties = { width: '100%', padding: '15px', marginTop: 18, border: 0, borderRadius: 14, background: 'linear-gradient(100deg,#7446ff,#315bff)', color: 'white', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

  return <main dir={rtl ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, boxSizing: 'border-box', background: '#090817', color: '#f7f6ff', fontFamily: 'Tajawal, sans-serif' }}>
    <form onSubmit={submit} style={{ width: 'min(100%, 520px)', boxSizing: 'border-box', padding: 'clamp(24px, 7vw, 48px)', border: '1px solid #302d55', borderRadius: 28, background: '#12112a', boxShadow: '0 24px 80px #0006' }}>
      <h1 style={{ textAlign: 'center', fontSize: 30, margin: '0 0 12px' }}>{t.title}</h1>
      <h2 style={{ textAlign: 'center', fontSize: 25, margin: '0 0 24px' }}>{mode === 'signup' ? t.signUp : mode === 'verify' ? t.verify : t.signIn}</h2>
      {mode === 'signup' && <label style={{ display: 'block', marginTop: 14 }}>{t.name}<input style={field} autoComplete="name" required value={name} onChange={e => setName(e.target.value)} /></label>}
      {mode !== 'verify' && <>
        <label style={{ display: 'block', marginTop: 14 }}>{t.email}<input style={field} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label style={{ display: 'block', marginTop: 14 }}>{t.password}<input style={field} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      </>}
      {mode === 'verify' && <label style={{ display: 'block', marginTop: 14 }}>{t.code}<input style={field} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} /></label>}
      {message && <p role="status" style={{ color: '#d6c9ff', lineHeight: 1.6 }}>{message}</p>}
      <button style={{ ...button, opacity: busy ? .65 : 1 }} disabled={busy}>{busy ? '…' : mode === 'signup' ? t.create : mode === 'verify' ? t.verify : t.continue}</button>
      {mode === 'verify' && <button type="button" onClick={resend} disabled={busy} style={{ ...button, marginTop: 10, background: 'transparent', border: '1px solid #514b83' }}>{t.resend}</button>}
      {mode !== 'verify' && <button type="button" onClick={() => { setMessage(''); setMode(mode === 'signin' ? 'signup' : 'signin'); }} style={{ display: 'block', width: '100%', marginTop: 20, padding: 8, border: 0, background: 'transparent', color: '#a98bff', fontSize: 15, cursor: 'pointer' }}>{mode === 'signin' ? t.noAccount : t.haveAccount}</button>}
      {mode === 'verify' && <button type="button" onClick={() => { setMessage(''); setMode('signin'); }} style={{ display: 'block', width: '100%', marginTop: 12, padding: 8, border: 0, background: 'transparent', color: '#a98bff', fontSize: 15, cursor: 'pointer' }}>{t.back}</button>}
    </form>
  </main>;
}
