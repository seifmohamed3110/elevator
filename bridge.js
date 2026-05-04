// Bridge server — receives plain HTTP from ESP8266, forwards to Supabase HTTPS
// Run with: node bridge.js

const express = require('express');
const app = express();
app.use(express.json());

const SUPABASE_URL = 'https://uiyobhowkynwzbakfyip.supabase.co';
const ANON_KEY     = 'sb_publishable_xZ3TtXLMKEb7d3wc41HvtA_nJZJHx5O';

app.post('/reading', async (req, res) => {
  const temp = typeof req.body.temperature === 'number' ? req.body.temperature : null;

  console.log(`Received from ESP8266 → temperature: ${temp} °C`);

  const payload = {
    temperature: temp,
    smoke_level: null,
    weight:      null,
    distance:    null,
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-reading`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('Supabase response:', data);
    res.json(data);

  } catch (err) {
    console.error('Error forwarding to Supabase:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Bridge running — waiting for ESP8266 on port 3000');
  console.log('Make sure your PC and ESP8266 are on the same WiFi network');
});
