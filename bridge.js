// Bridge server — receives plain HTTP from ESP8266, forwards to Supabase HTTPS
// Run with: node bridge.js

const express = require('express');
const app = express();

// Accept application/json AND plain text (ESP8266 sometimes omits Content-Type)
app.use(express.json({ type: ['application/json', 'text/plain', '*/*'] }));
app.use(express.text({ type: '*/*' }));

const SUPABASE_URL = 'https://uiyobhowkynwzbakfyip.supabase.co';
const ANON_KEY     = 'sb_publishable_xZ3TtXLMKEb7d3wc41HvtA_nJZJHx5O';

const SEP = '─'.repeat(55);

function ts() { return new Date().toISOString(); }

function log(label, value) {
  if (value !== undefined) {
    console.log(`[${ts()}] ${label}`, typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
  } else {
    console.log(`[${ts()}] ${label}`);
  }
}

app.post('/reading', async (req, res) => {
  console.log(`\n${SEP}`);
  log('▶ INCOMING REQUEST from', req.ip);
  log('  Content-Type:', req.headers['content-type'] || '(none — ESP8266 may have omitted it)');
  log('  Raw body:', req.body);

  // If express.text() caught it (no Content-Type), try parsing manually
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
      log('  Parsed from raw text:', body);
    } catch {
      log('  ERROR: body is not valid JSON:', body);
      return res.status(400).json({ error: 'Invalid JSON', received: body });
    }
  }

  if (!body || typeof body !== 'object') {
    log('  ERROR: empty or non-object body');
    return res.status(400).json({ error: 'Empty body' });
  }

  log('  Parsed JSON body:', body);

  const temp       = typeof body.temperature === 'number' ? body.temperature : null;
  const smoke      = typeof body.smoke_level === 'number' ? body.smoke_level : null;
  const weight     = typeof body.weight      === 'number' ? body.weight      : null;
  const distance   = typeof body.distance    === 'number' ? body.distance    : null;

  if (temp === null) {
    log('  ⚠ WARNING: temperature missing or not a number (got:', body.temperature + ')');
  } else {
    log(`  ✔ Temperature: ${temp} °C`);
  }

  const payload = { temperature: temp, smoke_level: smoke, weight, distance };
  log('▶ Forwarding to Supabase:', payload);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-reading`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    log(`▶ Supabase HTTP status: ${response.status} ${response.statusText}`);

    let data;
    try {
      data = await response.json();
    } catch {
      const text = await response.text();
      log('  ERROR: Supabase response is not JSON:', text);
      return res.status(502).json({ error: 'Supabase non-JSON response', body: text });
    }

    if (response.ok) {
      log('✅ Supabase success:', data);
    } else {
      log('❌ Supabase error response:', data);
    }

    console.log(SEP);
    return res.status(response.ok ? 200 : response.status).json(data);

  } catch (err) {
    log('❌ Network error reaching Supabase:', err.message);
    log('   Stack:', err.stack);
    console.log(SEP);
    return res.status(500).json({ error: err.message });
  }
});

// Quick health check — open http://<PC-IP>:3000/health in a browser to verify bridge is up
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: ts(), supabase: SUPABASE_URL });
  log('  /health ping');
});

app.listen(3000, '0.0.0.0', () => {
  console.log(SEP);
  log('🚀 Bridge running on 0.0.0.0:3000');
  log('   Supabase target:', `${SUPABASE_URL}/functions/v1/process-reading`);
  log('   Health check:   http://localhost:3000/health');
  log('   ESP8266 target: http://172.20.10.2:3000/reading');
  console.log(SEP);
});
