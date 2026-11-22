import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AuthGate from './AuthGate';
import Studio from './Studio';
import './styles.css';

function Root() {
  const [session,setSession] = useState<Session|null>(null);
  const [ready,setReady] = useState(false);
  const recovery = new URLSearchParams(window.location.search).has('reset-password');
  useEffect(() => {
    if(!supabase){setReady(true);return;}
    void supabase.auth.getSession().then(({data})=>{setSession(data.session);setReady(true);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));
    return ()=>subscription.unsubscribe();
  },[]);
  if(!ready)return <div style={{minHeight:'100vh',background:'#090817'}}/>;
  return session&&!recovery?<Studio session={session}/>:<AuthGate/>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
if('serviceWorker'in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(console.error));
