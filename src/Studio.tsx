import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Activity, AudioLines, Bell, CheckCircle2, ChevronDown, CircleHelp, Clock3, Coins, Crown, Film, FolderOpen, Globe2, Image as ImageIcon, Languages, LogOut, Menu, MessageCircle, Mic2, Moon, Music2, Play, Plus, Rocket, Send, Settings2, ShieldCheck, Sparkles, Sun, WandSparkles, Wallet, X, Zap } from 'lucide-react';
import { supabase } from './lib/supabase';
import './studio.css';

type Service = 'chat' | 'image' | 'tts' | 'video' | 'clone' | 'dub';
type Project = { id:string; title:string; service:string; status:string; created_at:string; result_url?:string|null };
type Profile = { display_name?:string|null; current_plan?:string|null };
const supported = new Set<Service>(['chat','image','tts']);
const serviceList: {id:Service;icon:typeof MessageCircle;title:string;subtitle:string;accent:string}[] = [
  {id:'chat',icon:MessageCircle,title:'المحادثة الذكية',subtitle:'اكتب، اسأل، ابتكر',accent:'violet'},
  {id:'tts',icon:AudioLines,title:'تحويل النص إلى صوت',subtitle:'أصوات متعددة اللغات',accent:'green'},
  {id:'image',icon:ImageIcon,title:'توليد الصور',subtitle:'حوّل أفكارك إلى صور',accent:'amber'},
  {id:'video',icon:Film,title:'توليد الفيديو',subtitle:'فيديو بالذكاء الاصطناعي',accent:'blue'},
  {id:'clone',icon:Mic2,title:'استنساخ الأصوات',subtitle:'صوت بموافقة صاحبه',accent:'pink'},
  {id:'dub',icon:Languages,title:'الدبلجة والترجمة',subtitle:'ترجمة المحتوى الصوتي',accent:'cyan'},
];
const nav = [
  {id:'home',label:'لوحة التحكم',icon:Activity}, {id:'chat',label:'المحادثة الذكية',icon:MessageCircle},
  {id:'tts',label:'تحويل النص إلى صوت',icon:AudioLines}, {id:'clone',label:'استنساخ الأصوات',icon:Mic2},
  {id:'dub',label:'الدبلجة والترجمة',icon:Languages}, {id:'image',label:'توليد الصور',icon:ImageIcon},
  {id:'video',label:'توليد الفيديو',icon:Film}, {id:'projects',label:'مشاريعي',icon:FolderOpen},
  {id:'plans',label:'الاشتراكات والخطط',icon:Crown}, {id:'wallet',label:'المحفظة',icon:Wallet},
];
const prettyDate = (date:string) => new Date(date).toLocaleDateString('ar', { day:'numeric', month:'short' });

export default function Studio({session}:{session:Session}) {
  const [lang,setLang] = useState<'ar'|'en'>(() => localStorage.getItem('jamil-lang') === 'en' ? 'en' : 'ar');
  const [dark,setDark] = useState(true);
  const [page,setPage] = useState('home');
  const [mobileOpen,setMobileOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [prompt,setPrompt] = useState('');
  const [notice,setNotice] = useState('');
  const [projects,setProjects] = useState<Project[]>([]);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [balance,setBalance] = useState<number|null>(null);
  const [totals,setTotals] = useState({all:0,done:0,active:0});
  const [chat,setChat] = useState<{role:'user'|'assistant';text:string}[]>([]);
  const [output,setOutput] = useState<{url?:string;text?:string}|null>(null);
  const [history,setHistory] = useState<number[]>(Array(7).fill(0));
  const rtl = lang === 'ar';
  const pageTitle = nav.find(n=>n.id===page)?.label || 'لوحة التحكم';
  const selectedService = serviceList.find(s=>s.id===page);
  const greetingName = profile?.display_name || session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'صديقنا';
  const greeting = useMemo(() => new Intl.DateTimeFormat(rtl?'ar':'en',{hour:'numeric'}).format(new Date()),[rtl]);

  useEffect(() => {
    document.documentElement.lang = lang; document.documentElement.dir = rtl?'rtl':'ltr';
    localStorage.setItem('jamil-lang',lang);
  },[lang,rtl]);
  useEffect(() => { void loadDashboard(); },[session.user.id]);
  async function loadDashboard() {
    if (!supabase) return;
    const [profileResult,walletResult,projectResult,allResult,doneResult,activeResult] = await Promise.all([
      supabase.from('profiles').select('display_name,current_plan').eq('id',session.user.id).maybeSingle(),
      supabase.from('wallets').select('balance').eq('user_id',session.user.id).maybeSingle(),
      supabase.from('projects').select('id,title,service,status,created_at,result_url').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(8),
      supabase.from('projects').select('id',{count:'exact',head:true}).eq('user_id',session.user.id),
      supabase.from('projects').select('id',{count:'exact',head:true}).eq('user_id',session.user.id).eq('status','completed'),
      supabase.from('projects').select('id',{count:'exact',head:true}).eq('user_id',session.user.id).in('status',['queued','processing']),
    ]);
    if (profileResult.data) setProfile(profileResult.data);
    if (walletResult.data) setBalance(walletResult.data.balance);
    if (projectResult.data) setProjects(projectResult.data as Project[]);
    setTotals({all:allResult.count||0,done:doneResult.count||0,active:activeResult.count||0});
    const week = Array(7).fill(0) as number[];
    (projectResult.data||[]).forEach(p=>{const days=Math.floor((Date.now()-new Date(p.created_at).getTime())/86400000);if(days>=0&&days<7)week[6-days]++;});
    setHistory(week);
  }
  function go(id:string) { setPage(id); setMobileOpen(false); setPrompt(''); setOutput(null); }
  function toast(text:string) { setNotice(text); window.setTimeout(()=>setNotice(''),5500); }
  async function signOut() { await supabase?.auth.signOut(); }
  async function runService(service:Service) {
    if (!supabase) return;
    if (!supported.has(service)) { toast('هذه الخدمة غير مفعّلة بعد. أضف تكامل مزودها في الخادم أولاً.'); return; }
    if (!prompt.trim()) { toast(rtl?'اكتب وصفك أو النص أولاً.':'Enter a prompt or text first.'); return; }
    setBusy(true);setOutput(null);
    if(service==='chat')setChat(items=>[...items,{role:'user',text:prompt.trim()}]);
    try {
      const {data,error} = await supabase.functions.invoke('ai-generate',{body:{service,prompt:prompt.trim()},headers:{'Idempotency-Key':crypto.randomUUID()}});
      if(error) {
        let reason = error.message;
        try { const context = (error as unknown as {context?:Response}).context; const body = await context?.clone().json(); reason = body?.error || reason; } catch { /* use SDK error */ }
        throw new Error(reason);
      }
      if(data?.error)throw new Error(data.error);
      if(service==='chat') { const text=typeof data?.text==='string'?data.text:'تم تنفيذ الطلب.';setChat(items=>[...items,{role:'assistant',text}]); }
      else setOutput({url:typeof data?.result_url==='string'?data.result_url:undefined,text:service==='tts'?'اكتمل إنشاء الصوت':'اكتمل إنشاء الصورة'});
      setPrompt(''); await loadDashboard();
    } catch(error) {
      const reason=error instanceof Error?error.message:'تعذر تنفيذ الطلب';
      toast(reason);
      if(service==='chat')setChat(items=>[...items,{role:'assistant',text:`تعذر إكمال الطلب: ${reason}`}]);
    } finally { setBusy(false); }
  }
  const maxHistory=Math.max(1,...history);
  const projectStatus=(status:string)=>status==='completed'?'مكتمل':status==='failed'?'تعذر التنفيذ':status==='processing'?'قيد التنفي��':'في الانتظار';

  return <div className={`studio-shell ${dark?'studio-dark':'studio-light'}`} dir={rtl?'rtl':'ltr'}>
    <aside className={`studio-sidebar ${mobileOpen?'is-open':''}`}>
      <div className="studio-brand"><div className="brand-glyph"><Music2 size={26}/><Play size={22} fill="currentColor"/></div><div><strong>JAMIL <b>AI</b></strong><small>مستقبل الإبداع بين يديك</small></div><button className="sidebar-close" onClick={()=>setMobileOpen(false)} aria-label="إغلاق"><X size={20}/></button></div>
      <div className="side-caption">مساحة العمل</div><nav className="studio-nav">{nav.map(item=>{const Icon=item.icon;return <button key={item.id} className={page===item.id?'active':''} onClick={()=>go(item.id)}><Icon size={18}/><span>{item.label}</span>{item.id==='wallet'&&balance!==null&&<b className="nav-balance">{balance}</b>}</button>})}</nav>
      <div className="sidebar-bottom"><div className="side-secure"><ShieldCheck size={18}/><span>مساحة آمنة وخاصة</span></div><button className="side-logout" onClick={signOut}><LogOut size={18}/> تسجيل الخروج</button><div className="side-user"><div className="user-avatar">{greetingName.slice(0,1).toUpperCase()}</div><div className="user-label"><b>{greetingName}</b><small>{session.user.email}</small></div><button className="user-more" aria-label="إعدادات المستخدم"><Settings2 size={17}/></button></div></div>
    </aside>
    {mobileOpen&&<button className="studio-scrim" onClick={()=>setMobileOpen(false)} aria-label="إغلاق القائمة"/>}
    <main className="studio-main">
      <header className="studio-topbar"><button className="mobile-menu" onClick={()=>setMobileOpen(true)} aria-label="فتح القائمة"><Menu/></button><div className="breadcrumb"><span>JAMIL AI</span><i>/</i><b>{pageTitle}</b></div><div className="top-actions"><button className="top-language" onClick={()=>setLang(rtl?'en':'ar')}><Globe2 size={17}/>{rtl?'English':'العربية'}<ChevronDown size={14}/></button><button className="round-action" onClick={()=>setDark(!dark)} aria-label="تبديل السمة">{dark?<Sun size={18}/>:<Moon size={18}/>}</button><span className="top-user"><span className="top-avatar">{greetingName.slice(0,1).toUpperCase()}</span><b>{greetingName}</b></span></div></header>
      <div className="studio-content">
        {page==='home'&&<>
          <section className="welcome-hero"><div className="hero-glow hero-glow-a"/><div className="hero-glow hero-glow-b"/><div className="hero-copy"><span className="hero-kicker"><Sparkles size={14}/> منصة الذكاء الاصطناعي الإبداعية</span><h1>مرحباً بك، <span>{greetingName}</span></h1><p>حوّل أفكارك إلى محتوى مميز باستخدا�� أدوات الذكاء الاصطناعي.</p><button className="hero-cta" onClick={()=>go('chat')}>ابدأ الإبداع الآن <Rocket size={17}/></button></div><div className="hero-orb"><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><div className="orb-core"><WandSparkles size={43}/></div><span className="orb-spark spark-one">✦</span><span className="orb-spark spark-two">✧</span></div><div className="hero-footnote"><Zap size={14}/> أدواتك الإبداعية في مكان واحد</div></section>
          <section className="metric-grid"><Metric icon={FolderOpen} label="المشاريع" value={totals.all} accent="purple"/><Metric icon={CheckCircle2} label="مكتملة" value={totals.done} accent="green"/><Metric icon={Clock3} label="قيد التنفيذ" value={totals.active} accent="blue"/><Metric icon={Coins} label="رصيد المحفظة" value={balance===null?'—':balance} suffix="رصيد" accent="amber"/></section>
          <section className="overview-grid"><div className="glass-panel activity-panel"><div className="panel-heading"><div><span className="section-eyebrow">نشاطك</span><h2>ملخص النشاط</h2></div><span className="period-pill">آخر 7 أيام</span></div><div className="activity-chart" aria-label="عدد المشاريع لكل يوم">{history.map((count,i)=><div className="chart-column" key={i}><span className="chart-count">{count}</span><div className="chart-track"><i style={{height:`${Math.max(count?24:5,Math.round(count/maxHistory*100))}%`}}/></div><small>{['س','ح','ن','ث','ر','خ','ج'][i]}</small></div>)}</div><div className="chart-legend"><i/> مشاريعك المسجلة في قاعدة البيانات</div></div><div className="glass-panel recent-panel"><div className="panel-heading"><div><span className="section-eyebrow">آخر التحديثات</span><h2>مشاريعك الأخيرة</h2></div><button className="inline-link" onClick={()=>go('projects')}>عرض الكل ←</button></div>{projects.length?projects.slice(0,4).map(project=><ProjectItem key={project.id} project={project} status={projectStatus(project.status)}/>):<div className="empty-state"><FolderOpen size={24}/><span>لم تنشئ مشاريع بعد. ابدأ بأول فكرة!</span></div>}</div></section>
          <section className="services-section"><div className="section-title"><div><span className="section-eyebrow">ابدأ بصنع شيء جديد</span><h2>خدمات الذكاء الاصطناعي</h2></div><span className="service-count">6 أدوات</span></div><div className="service-grid">{serviceList.map(service=><ServiceCard key={service.id} service={service} enabled={supported.has(service.id)} onClick={()=>go(service.id)}/>)}</div></section>
        </>}
        {page==='projects'&&<section className="content-page"><PageHeader title="مشاريعي" subtitle="كل أعمالك الإبداعية محفوظة في مكان واحد."/><div className="glass-panel projects-list">{projects.length?projects.map(project=><ProjectItem key={project.id} project={project} status={projectStatus(project.status)}/>):<div className="empty-state"><FolderOpen size={28}/><span>لا توجد مشاريع بعد.</span></div>}</div></section>}
        {page==='wallet'&&<section className="content-page"><PageHeader title="المحفظة" subtitle="تابع رصيدك واستخدامك."/><div className="wallet-hero glass-panel"><Coins size={36}/><div><small>رصيدك الحالي</small><strong>{balance===null?'—':balance} <small>رصيد</small></strong></div></div><div className="glass-panel info-panel"><h3>إدارة الرصيد</h3><p>يمكنك مراجعة الخطط وطرق شحن الرصيد من صفحة الاشتراكات.</p><button className="hero-cta" onClick={()=>go('plans')}>عرض الخطط <Crown size={16}/></button></div></section>}
        {page==='plans'&&<section className="content-page"><PageHeader title="الاشتراكات والخطط" subtitle="اختر الخطة المناسبة لاحتياجاتك."/><PlansView lang={lang}/></section>}
        {selectedService&&<section className="content-page service-page"><PageHeader title={selectedService.title} subtitle={selectedService.subtitle}/>{supported.has(selectedService.id)?<div className="studio-workspace"><div className="work-toolbar"><div className={`service-mark ${selectedService.accent}`}><selectedService.icon size={22}/></div><div><b>{selectedService.title}</b><small>معالجة آمنة عبر خادم JAMIL AI</small></div><span className="secure-tag"><ShieldCheck size={14}/> خاص</span></div>{page==='chat'&&<div className="chat-transcript">{chat.length?chat.map((item,index)=><div key={index} className={`chat-bubble ${item.role}`}>{item.role==='assistant'&&<span className="assistant-mark"><Sparkles size={14}/></span>}{item.text}</div>):<div className="chat-welcome"><div className="chat-welcome-icon"><WandSparkles size={28}/></div><h3>كيف يمكنني مساعدتك؟</h3><p>اكتب سؤالاً أو فكرة، وسأساعدك على تطويرها.</p></div>}</div>}<div className="prompt-area"><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(page==='chat'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();void runService('chat');}}} placeholder={page==='chat'?'اكتب رسالتك هنا...':page==='image'?'صف الصورة التي تريد إنشاءها...':'اكتب النص المراد تحويله إلى صوت...'} rows={4} maxLength={12000}/><div className="prompt-footer"><span>{prompt.length.toLocaleString()} / 12,000</span><button className="submit-prompt" disabled={busy||!prompt.trim()} onClick={()=>void runService(selectedService.id)}>{busy?<span className="loading-dot">جارٍ التنفيذ...</span>:<>{page==='chat'?'إرسال':page==='image'?'إنشاء صورة':'إنشاء صوت'} <Send size={16}/></>}</button></div></div>{output&&<div className="result-card">{output.text&&<b>{output.text}</b>}{output.url&&page==='image'&&<img src={output.url} alt="الصورة المولدة"/>}{output.url&&page==='tts'&&<audio controls src={output.url}/ >}{output.url&&<a href={output.url} target="_blank" rel="noreferrer">فتح النتيجة في نافذة جديدة</a>}</div>}<p className="workspace-note">{page==='chat'?'لا تشارك كلمات مرور أو بيانات شديدة الحساسية.':page==='image'?'تُحفظ النتائج في مشاريعك الخاصة.':'سيتم إنشاء الصوت وحفظه ضمن ملفاتك الخاصة.'}</p></div>:<div className="coming-soon glass-panel"><div className={`service-mark ${selectedService.accent}`}><selectedService.icon size={24}/></div><span className="coming-badge">قريباً</span><h2>{selectedService.title}</h2><p>لم يتم تفعيل مزود هذه الخدمة على الخادم بعد. لن نعرض لك زرًا يوهمك بأن الخدمة تعمل قبل إعدادها واختبارها.</p><button className="secondary-action" onClick={()=>go('home')}>العودة للوحة التحكم</button></div>}</section>}
      </div>
      <footer className="studio-footer"><span>JAMIL AI © 2026</span><span><ShieldCheck size={15}/> بياناتك محمية ومشفرة</span><span>متاح على جميع الأجهزة</span></footer>
    </main>
    {notice&&<div className="studio-toast" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="إغلاق"><X size={16}/></button></div>}
  </div>;
}
function Metric({icon:Icon,label,value,suffix,accent}:{icon:typeof Coins;label:string;value:string|number;suffix?:string;accent:string}){return <article className={`metric-card ${accent}`}><span className="metric-icon"><Icon size={20}/></span><div><small>{label}</small><strong>{value} {suffix&&<i>{suffix}</i>}</strong></div></article>}
function ServiceCard({service,enabled,onClick}:{service:typeof serviceList[number];enabled:boolean;onClick:()=>void}){const Icon=service.icon;return <button className={`service-card ${service.accent}`} onClick={onClick}><span className="service-icon"><Icon size={22}/></span><span className="service-card-copy"><b>{service.title}</b><small>{enabled?service.subtitle:'التكامل غير مفعّل بعد'}</small></span><span className={`availability ${enabled?'ready':''}`}>{enabled?'متاح':'قريباً'}</span><Plus size={16} className="service-plus"/></button>}
function PageHeader({title,subtitle}:{title:string;subtitle:string}){return <div className="page-header"><span className="section-eyebrow">JAMIL AI STUDIO</span><h1>{title}</h1><p>{subtitle}</p></div>}
function ProjectItem({project,status}:{project:Project;status:string}){return <article className="project-item"><div className={`project-icon ${project.service}`}><Sparkles size={18}/></div><div className="project-meta"><b>{project.title||project.service}</b><small>{project.service} · {prettyDate(project.created_at)}</small></div><span className={`project-status ${project.status}`}>{status}</span>{project.result_url&&<a className="project-open" href={project.result_url} target="_blank" rel="noreferrer" aria-label="فتح النتيجة"><Play size={15}/></a>}</article>}
function PlansView({lang}:{lang:'ar'|'en'}){const [plans,setPlans]=useState<{id:string;name:string;price:number;credits:number;duration_days:number}[]>([]);const [error,setError]=useState('');useEffect(()=>{if(!supabase)return;supabase.from('plans').select('id,name,price,credits,duration_days').eq('is_active',true).order('price').then(({data,error})=>{if(error)setError(error.message);else setPlans(data||[]);});},[]);return <div className="plans-grid">{error?<div className="glass-panel empty-state">تعذر تحميل الخطط: {error}</div>:plans.length?plans.map(plan=><article className="plan-card glass-panel" key={plan.id}><Crown size={24}/><h3>{plan.name}</h3><strong>{plan.price} <small>{lang==='ar'?'ر.س':'SAR'}</small></strong><p>{plan.credits} رصيد · {plan.duration_days} يوم</p><span className="plan-note">تواصل مع الدعم لإتمام الاشتراك.</span></article>):<div className="glass-panel empty-state"><CircleHelp size={22}/><span>لا توجد خطط متاحة حالياً. أضف الخطط من لوحة الإدارة.</span></div>}</div>}
