// index.ts — Supabase Edge Function: process-reading
// ESP8266 calls this endpoint with sensor data every ~2 seconds.
// Runs detection logic, inserts reading, creates alerts, sends email.

import { createClient }                     from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluate, getDefaultState }        from './detectionService.ts';
import { sendAlertEmail }                   from './emailService.ts';
import type { DetectionState, FloorRange }  from './detectionService.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405);

  try {
    // ── Parse incoming sensor payload ──────────────────────────────────────
    const body = await req.json();
    const reading = {
      temperature: typeof body.temperature === 'number' ? body.temperature : null,
      smoke_level: typeof body.smoke_level === 'number' ? body.smoke_level : null,
      weight:      typeof body.weight      === 'number' ? body.weight      : null,
      distance:    typeof body.distance    === 'number' ? body.distance    : null,
    };

    const now = Date.now();

    // ── Supabase admin client (bypasses RLS via service_role key) ──────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Read detection_state + calibration in parallel ─────────────────────
    const [stateRes, calibRes] = await Promise.all([
      supabase.from('detection_state').select('state').eq('id', 1).single(),
      supabase.from('floor_calibration').select('floor_number, min_distance, max_distance, label'),
    ]);

    // Merge stored state with defaults (handles empty/missing state)
    const storedState = stateRes.data?.state ?? {};
    const defaultState = getDefaultState();
    const state: DetectionState = {
      temperature: { ...defaultState.temperature, ...storedState.temperature },
      smoke:       { ...defaultState.smoke,       ...storedState.smoke },
      overload:    { ...defaultState.overload,     ...storedState.overload },
      stuck:       { ...defaultState.stuck,        ...storedState.stuck },
    };

    // Build calibration map: { "0": { min_distance, max_distance, label }, ... }
    const calibration: Record<string, FloorRange> = {};
    for (const row of (calibRes.data ?? [])) {
      calibration[String(row.floor_number)] = {
        min_distance: row.min_distance,
        max_distance: row.max_distance,
        label:        row.label,
      };
    }

    // ── Run detection logic ────────────────────────────────────────────────
    const { alerts, updatedState, status, floor, is_moving } = await evaluate(
      reading, state, calibration, now,
    );

    // ── Insert sensor reading + update detection state (parallel) ──────────
    const enrichedReading = { ...reading, floor, is_moving, status };

    const [insertErr, stateErr] = await Promise.all([
      supabase.from('sensor_readings').insert(enrichedReading).then(r => r.error),
      supabase.from('detection_state')
        .update({ state: updatedState, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .then(r => r.error),
    ]);

    if (insertErr) console.error('sensor_readings insert error:', insertErr);
    if (stateErr)  console.error('detection_state update error:', stateErr);

    // ── Create alerts + send emails ─────────────────────────────────────────
    for (const alert of alerts) {
      const { data: alertRow, error: alertErr } = await supabase
        .from('alerts')
        .insert({
          type:          alert.type,
          category:      alert.category,
          message:       alert.message,
          sensor_values: reading,
          floor,
          acknowledged:  false,
          email_sent:    false,
        })
        .select('id')
        .single();

      if (alertErr || !alertRow) {
        console.error('alerts insert error:', alertErr);
        continue;
      }

      const emailSent = await sendAlertEmail(alert, { ...reading, floor });
      if (emailSent) {
        await supabase.from('alerts').update({ email_sent: true }).eq('id', alertRow.id);
      }
    }

    return json({ ok: true, status, floor, is_moving, alerts_triggered: alerts.length });

  } catch (err) {
    console.error('process-reading unhandled error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
