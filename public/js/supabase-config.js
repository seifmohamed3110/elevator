/**
 * Supabase client configuration.
 *
 * SETUP STEPS:
 * 1. Go to https://supabase.com and create a free project
 * 2. Open your project → Settings → API
 * 3. Copy "Project URL" → paste as SUPABASE_URL below
 * 4. Copy "anon / public" key → paste as SUPABASE_ANON_KEY below
 * 5. Run the SQL in supabase/migrations/20240101000000_initial.sql
 *    in Supabase Dashboard → SQL Editor
 * 6. Deploy the Edge Function:
 *    supabase functions deploy process-reading
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Replace with your Supabase project values ───────────────────────────────
const SUPABASE_URL      = 'https://uiyobhowkynwzbakfyip.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xZ3TtXLMKEb7d3wc41HvtA_nJZJHx5O';
// ───────────────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
