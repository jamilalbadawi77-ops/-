import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, idempotency-key','Access-Control-Allow-Methods':'POST, OPTIONS'};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const auth=req.headers.get('Authorization');if(!auth)return respond({error:'Authentication required'},401);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user},error:authError}=await userClient.auth.getUser();if(authError||!user)return respond({error:'Invalid session'},401);
 let body:any;try{body=await req.json()}catch{return respond({error:'Invalid JSON'},400)}
 const service=String(body.service||''),prompt=String(body.prompt||'').trim();if(!['chat','image','tts'].includes(service))return respond({error:'This service is not enabled on this function yet'},400);if(!prompt||prompt.length>12000)return respond({error:'Prompt is required and must be under 12000 characters'},400);
 const admin=createClient(url,serviceKey);const {data:settings,error:settingError}=await admin.from('service_settings').select('enabled,credit_cost').eq('service',service).maybeSingle();if(settingError||!settings?.enabled)return respond({error:'Service is currently unavailable'},503);
 const key=req.headers.get('Idempotency-Key')||String(body.idempotency_key||crypto.randomUUID());if(key.length<8||key.length>120)return respond({error:'Invalid idempotency key'},400);
 const cost=Number(settings.credit_cost);if(!Number.isInteger(cost)||cost<0)return respond({error:'Invalid service price'},500);
 const debit=await admin.rpc('debit_credits',{p_user_id:user.id,p_amount:cost,p_service:service,p_key:`debit:${key}`});if(debit.error)return respond({error:'Unable to reserve credits'},500);if(debit.data!==true)return respond({error:'Insufficient credits'},402);
 const projectId=crypto.randomUUID();const {error:insertError}=await admin.from('projects').insert({id:projectId,user_id:user.id,title:prompt.slice(0,90),service,status:'processing',input:{prompt}});if(insertError){await admin.rpc('refund_credits',{p_user_id:user.id,p_amount:cost,p_reason:`refund:${service}`,p_key:`refund:${key}`});return respond({error:'Could not create project'},500)}
 try{
  let result:any;let resultUrl:string|undefined;
  if(service==='chat'){
   const apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)throw new Error('OPENAI_API_KEY secret is not configured');
   const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'user',content:prompt}],max_tokens:1500})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||`OpenAI error ${r.status}`);result={text:j.choices?.[0]?.message?.content||''};
  }else if(service==='image'){
   const apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)throw new Error('OPENAI_API_KEY secret is not configured');
   const r=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-image-1',prompt,n:1,size:'1024x1024'})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||`OpenAI error ${r.status}`);const b64=j.data?.[0]?.b64_json;if(!b64)throw new Error('Image provider returned no output');const bytes=Uint8Array.from(atob(b64),(c)=>c.charCodeAt(0));const path=`${user.id}/${projectId}.png`;const uploaded=await admin.storage.from('user-files').upload(path,bytes,{contentType:'image/png',upsert:false});if(uploaded.error)throw new Error('Could not save generated image');resultUrl=path;result={path};
  }else{
   const apiKey=Deno.env.get('ELEVENLABS_API_KEY');if(!apiKey)throw new Error('ELEVENLABS_API_KEY secret is not configured');const r=await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM',{method:'POST',headers:{'xi-api-key':apiKey,'Content-Type':'application/json','Accept':'audio/mpeg'},body:JSON.stringify({text:prompt,model_id:'eleven_multilingual_v2'})});if(!r.ok){const msg=await r.text();throw new Error(`ElevenLabs error ${r.status}: ${msg.slice(0,300)}`)}const bytes=new Uint8Array(await r.arrayBuffer());const path=`${user.id}/${projectId}.mp3`;const uploaded=await admin.storage.from('user-files').upload(path,bytes,{contentType:'audio/mpeg',upsert:false});if(uploaded.error)throw new Error('Could not save generated audio');resultUrl=path;result={path};
  }
  await admin.from('projects').update({status:'completed',result_url:resultUrl,input:{prompt,result}}).eq('id',projectId);await admin.from('generations').insert({project_id:projectId,user_id:user.id,service,status:'completed',cost});return respond({project_id:projectId,...result});
 }catch(e){const msg=e instanceof Error?e.message:'Generation failed';await admin.from('projects').update({status:'failed',error_message:msg}).eq('id',projectId);await admin.from('generations').insert({project_id:projectId,user_id:user.id,service,status:'failed',cost,error_message:msg});await admin.rpc('refund_credits',{p_user_id:user.id,p_amount:cost,p_reason:`failed:${service}`,p_key:`refund:${key}`});return respond({error:msg},502)}
});
