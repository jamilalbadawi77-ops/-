# JAMIL AI — platform foundation

Arabic/English responsive React + TypeScript SaaS client, Supabase schema and protected server-side AI function foundation.

## Local development
1. Install Node.js 20+ and run `npm install`.
2. Copy `.env.example` to `.env.local`; set the Supabase project URL and public anon key. Never put provider API keys in `VITE_*` variables.
3. Run the SQL migration in `supabase/migrations` using Supabase CLI (`supabase db push`) or the SQL editor.
4. Install Supabase CLI, link the project and deploy Edge Functions. Add `OPENAI_API_KEY` as an Edge Function secret. ElevenLabs and fal secrets are needed for their respective integrations and are deliberately never exposed to the browser.
5. Run `npm run dev`; `npm run build` checks TypeScript and creates `dist/`.

## Important status
This initial repository commit provides the application shell, real Supabase email OTP auth, database-backed dashboard queries, guarded admin route, PWA shell, and a server-only OpenAI chat/image + ElevenLabs TTS function. It is not yet a production-complete commercial service: provider secrets, Supabase project, production hosting/domain, email delivery configuration, payment review workflow, provider-specific voice cloning/dubbing/video pipelines, async job polling, and end-to-end tests require external account configuration and follow-up implementation. Missing configuration is shown explicitly; no fabricated balances or success results are used.

## Security
Database access is RLS-protected. Provider keys belong only in Supabase Edge Function secrets. Do not commit `.env.local`, service-role keys, or third-party secrets. Admin authorization is queried from a server-controlled role table and enforced by RLS; never grant admin by client-side metadata.
