import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

type Service = 'chat' | 'image' | 'tts';
const isService = (value: string): value is Service => ['chat', 'image', 'tts'].includes(value);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !serviceKey) return respond({ error: 'Supabase function configuration is incomplete' }, 503);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return respond({ error: 'Authentication required' }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return respond({ error: 'Invalid session' }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return respond({ error: 'Invalid request body' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  const serviceValue = String(body.service ?? '');
  if (!isService(serviceValue)) return respond({ error: 'This service is not implemented by this function' }, 400);
  const service: Service = serviceValue;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 12000) return respond({ error: 'Prompt is required and must be under 12000 characters' }, 400);

  const key = req.headers.get('Idempotency-Key') || (typeof body.idempotency_key === 'string' ? body.idempotency_key : '');
  if (key.length < 8 || key.length > 120 || /[\r\n]/.test(key)) return respond({ error: 'A valid idempotency key is required' }, 400);

  // Check provider configuration before any credit reservation so unconfigured services
  // never charge a user.
  const providerKeyName = service === 'tts' ? 'ELEVENLABS_API_KEY' : 'OPENAI_API_KEY';
  const providerKey = Deno.env.get(providerKeyName);
  if (!providerKey) return respond({ error: `${providerKeyName} is not configured for this Edge Function` }, 503);

  const admin = createClient(url, serviceKey);
  const { data: settings, error: settingsError } = await admin
    .from('service_settings').select('enabled,credit_cost').eq('service', service).maybeSingle();
  if (settingsError) return respond({ error: 'Could not read service settings' }, 500);
  if (!settings?.enabled) return respond({ error: 'Service is currently unavailable' }, 503);
  const cost = Number(settings.credit_cost);
  if (!Number.isInteger(cost) || cost < 0) return respond({ error: 'Invalid service price' }, 500);

  const { data: reservation, error: reserveError } = await admin.rpc('reserve_generation', {
    p_user_id: user.id,
    p_title: prompt.slice(0, 90),
    p_service: service,
    p_amount: cost,
    p_key: key,
    p_input: { prompt },
  });
  if (reserveError) return respond({ error: 'Could not safely reserve this generation request' }, 500);
  const row = Array.isArray(reservation) ? reservation[0] : reservation;
  if (!row) return respond({ error: 'Generation reservation returned no project' }, 500);
  if (row.insufficient) return respond({ error: 'Insufficient credits' }, 402);

  const projectId = row.project_id as string;
  if (row.reused) {
    const { data: existing, error: existingError } = await admin.from('projects')
      .select('id,status,result_url,error_message,input').eq('id', projectId).maybeSingle();
    if (existingError || !existing) return respond({ error: 'Existing project could not be loaded' }, 500);
    if (existing.status === 'failed') return respond({ project_id: projectId, status: 'failed', error: existing.error_message || 'Previous attempt failed' }, 409);
    const priorResult = (existing.input as Record<string, unknown> | null)?.result as Record<string, unknown> | undefined;
    if (existing.status === 'completed' && existing.result_url && service !== 'chat') {
      const { data: signed } = await admin.storage.from('user-files').createSignedUrl(existing.result_url, 3600);
      return respond({ project_id: projectId, status: 'completed', result_url: signed?.signedUrl || null, ...priorResult });
    }
    if (existing.status === 'completed') return respond({ project_id: projectId, status: 'completed', ...priorResult });
    return respond({ project_id: projectId, status: existing.status }, 202);
  }

  let uploadedPath: string | null = null;
  try {
    const { error: generationInsertError } = await admin.from('generations').insert({
      project_id: projectId, user_id: user.id, service, status: 'processing', cost,
    });
    if (generationInsertError) throw new Error('Could not record generation status');

    let result: Record<string, unknown>;
    let resultPath: string | null = null;
    if (service === 'chat') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 1500 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `OpenAI request failed (${response.status})`);
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text) throw new Error('The model returned no text');
      result = { text };
    } else if (service === 'image') {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Image request failed (${response.status})`);
      const base64 = data.data?.[0]?.b64_json;
      if (typeof base64 !== 'string') throw new Error('Image provider returned no image data');
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      uploadedPath = `${user.id}/results/${projectId}.png`;
      const upload = await admin.storage.from('user-files').upload(uploadedPath, bytes, { contentType: 'image/png', upsert: false });
      if (upload.error) throw new Error('Could not save generated image');
      resultPath = uploadedPath;
      result = { path: uploadedPath };
    } else {
      const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
        method: 'POST',
        headers: { 'xi-api-key': providerKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: prompt, model_id: 'eleven_multilingual_v2' }),
      });
      if (!response.ok) throw new Error(`Speech request failed (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      uploadedPath = `${user.id}/results/${projectId}.mp3`;
      const upload = await admin.storage.from('user-files').upload(uploadedPath, bytes, { contentType: 'audio/mpeg', upsert: false });
      if (upload.error) throw new Error('Could not save generated audio');
      resultPath = uploadedPath;
      result = { path: uploadedPath };
    }

    const { error: projectUpdateError } = await admin.from('projects').update({
      status: 'completed', result_url: resultPath, input: { prompt, result }, updated_at: new Date().toISOString(),
    }).eq('id', projectId).eq('user_id', user.id);
    if (projectUpdateError) throw new Error('Could not save the project result');
    const { error: generationUpdateError } = await admin.from('generations').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('project_id', projectId);
    if (generationUpdateError) throw new Error('Could not finalize generation status');

    const signed = resultPath ? await admin.storage.from('user-files').createSignedUrl(resultPath, 3600) : null;
    return respond({ project_id: projectId, status: 'completed', ...result, ...(resultPath ? { result_url: signed?.data?.signedUrl || null } : {}) });
  } catch (error) {
    if (uploadedPath) await admin.storage.from('user-files').remove([uploadedPath]);
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Generation failed';
    await admin.from('projects').update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() }).eq('id', projectId);
    await admin.from('generations').update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() }).eq('project_id', projectId);
    await admin.rpc('refund_credits', {
      p_user_id: user.id,
      p_amount: cost,
      p_reason: `failed:${service}`,
      p_key: `refund:${user.id}:${key}`,
    });
    return respond({ project_id: projectId, status: 'failed', error: message }, 502);
  }
});
