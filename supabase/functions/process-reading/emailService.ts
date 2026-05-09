// emailService.ts — Resend API email sender (replaces Nodemailer)

const STATUS_COLOR: Record<string, string> = {
  warning:  '#f59e0b',
  danger:   '#f97316',
  critical: '#ef4444',
};

const CATEGORY_ICON: Record<string, string> = {
  temperature: '🌡️',
  smoke:       '💨',
  overload:    '⚖️',
  stuck:       '🛗',
};

function floorLabel(floor: number | null): string {
  if (floor == null || floor === -1) return 'Between Floors';
  if (floor === 0) return 'Ground Floor';
  return `Floor ${floor}`;
}

interface AlertInfo {
  type:     string;
  category: string;
  message:  string;
}

interface ReadingSnapshot {
  temperature: number | null;
  smoke_level: number | null;
  weight:      number | null;
  distance:    number | null;
  floor?:      number | null;
}

function buildHtml(alert: AlertInfo, reading: ReadingSnapshot): string {
  const color    = STATUS_COLOR[alert.type]    || '#6b7280';
  const icon     = CATEGORY_ICON[alert.category] || '⚠️';
  const category = alert.category.charAt(0).toUpperCase() + alert.category.slice(1);
  const ts       = new Date().toLocaleString();

  const row = (label: string, value: string, shaded = false) =>
    `<tr${shaded ? ' style="background:#f8fafc;"' : ''}>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;color:#64748b;font-weight:600;font-size:14px;width:40%;">${label}</td>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;color:#1e293b;font-size:14px;">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Elevator Alert</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.1);">
    <div style="background:${color};padding:32px 24px;text-align:center;">
      <div style="font-size:56px;line-height:1;">${icon}</div>
      <h1 style="color:#fff;margin:12px 0 4px;font-size:22px;font-weight:700;letter-spacing:1px;">
        ${alert.type.toUpperCase()} ALERT — ${category.toUpperCase()}
      </h1>
      <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;">${ts}</p>
    </div>
    <div style="padding:28px 24px;">
      <p style="color:#475569;font-size:15px;line-height:1.7;background:#f8fafc;border-left:4px solid ${color};padding:12px 16px;border-radius:4px;margin:0 0 24px;">
        ${alert.message}
      </p>
      <h2 style="color:#1e293b;font-size:15px;margin:0 0 12px;">Sensor Readings at Time of Alert</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${row('Temperature', reading.temperature != null ? `${reading.temperature.toFixed(1)} °C` : '--', true)}
        ${row('Smoke Level', reading.smoke_level != null ? reading.smoke_level.toFixed(0) : '--')}
        ${row('Weight / Load', reading.weight != null ? `${reading.weight.toFixed(1)} kg` : '--', true)}
        ${row('Distance (TOF)', reading.distance != null ? `${reading.distance.toFixed(1)} cm` : '--')}
        ${row('Elevator Floor', floorLabel(reading.floor ?? null), true)}
      </table>
      <div style="margin-top:20px;padding:14px 16px;background:#fef3c7;border-radius:8px;border-left:4px solid #f59e0b;">
        <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
          ⚠️ This is an automated alert from the <strong>Smart Elevator Monitoring System</strong>.
          Please inspect the elevator immediately and acknowledge the alert on the dashboard.
        </p>
      </div>
    </div>
    <div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">Smart Elevator Monitoring System &copy; ${new Date().getFullYear()} — IoT Prototype</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send an alert email via the Resend API.
 * Requires RESEND_API_KEY and ALERT_EMAIL_TO in Supabase Edge Function secrets.
 * Returns true if the email was sent successfully.
 */
export async function sendAlertEmail(alert: AlertInfo, reading: ReadingSnapshot): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? 're_UKqtoDJU_3WRtNBp4q78Ni38S4qubVsQd';
  const to     = Deno.env.get('ALERT_EMAIL_TO')  ?? 'elevatorwebsite@gmail.com';

  const category = alert.category.charAt(0).toUpperCase() + alert.category.slice(1);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${apiKey}`,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({
      from:    'Elevator Monitor <onboarding@resend.dev>',
      to:      [to],
      subject: `[${alert.type.toUpperCase()}] Elevator Alert — ${category}`,
      html:    buildHtml(alert, reading),
    }),
  });

  if (!res.ok) {
    console.error('Resend API error:', res.status, await res.text());
    return false;
  }

  console.info(`Alert email sent to ${to} — [${alert.type}] ${alert.category}`);
  return true;
}
