// detectionService.ts — TypeScript port of the original Node.js detection logic

const THRESHOLDS = {
  TEMP_WARNING_C:       28,
  TEMP_DANGER_C:        32,
  TEMP_DURATION_MS:     10_000,
  SMOKE_LEVEL:          300,
  SMOKE_DURATION_MS:    10_000,
  OVERLOAD_KG:          150,
  OVERLOAD_DURATION_MS: 5_000,
  STUCK_TOLERANCE_CM:   2,
  STUCK_DURATION_MS:    30_000,
  ALERT_COOLDOWN_MS:    20 * 1_000,
} as const;

export interface SensorReading {
  temperature: number | null;
  smoke_level: number | null;
  weight:      number | null;
  distance:    number | null;
}

export interface AlertEntry {
  type:     'warning' | 'danger' | 'critical';
  category: 'temperature' | 'smoke' | 'overload' | 'stuck';
  message:  string;
}

export interface DetectionState {
  temperature: { abnormal_since: number | null; last_alerted_at: number | null };
  smoke:       { abnormal_since: number | null; last_alerted_at: number | null };
  overload:    { abnormal_since: number | null; last_alerted_at: number | null };
  stuck: {
    abnormal_since:  number | null;
    last_alerted_at: number | null;
    last_distance:   number | null;
    last_moved_at:   number | null;
  };
}

export interface FloorRange {
  min_distance: number;
  max_distance: number;
  label:        string;
}

export interface EvaluateResult {
  alerts:       AlertEntry[];
  updatedState: DetectionState;
  status:       'normal' | 'warning' | 'danger' | 'critical';
  floor:        number;
  is_moving:    boolean;
}

export function getDefaultState(): DetectionState {
  return {
    temperature: { abnormal_since: null, last_alerted_at: null },
    smoke:       { abnormal_since: null, last_alerted_at: null },
    overload:    { abnormal_since: null, last_alerted_at: null },
    stuck: { abnormal_since: null, last_alerted_at: null, last_distance: null, last_moved_at: null },
  };
}

function computeFloor(distance: number | null, calibration: Record<string, FloorRange>): number {
  if (distance == null) return -1;
  for (const [floorNum, range] of Object.entries(calibration)) {
    if (distance >= range.min_distance && distance <= range.max_distance) {
      return parseInt(floorNum, 10);
    }
  }
  return -1;
}

function recentlyAlerted(entry: { last_alerted_at: number | null }, now: number): boolean {
  if (!entry.last_alerted_at) return false;
  return (now - entry.last_alerted_at) < THRESHOLDS.ALERT_COOLDOWN_MS;
}

export function evaluate(
  reading:     SensorReading,
  state:       DetectionState,
  calibration: Record<string, FloorRange>,
  now:         number,
): EvaluateResult {
  const alerts: AlertEntry[] = [];
  const s: DetectionState = JSON.parse(JSON.stringify(state));
  let status: 'normal' | 'warning' | 'danger' | 'critical' = 'normal';

  const { temperature: temp, smoke_level: smoke, weight, distance: dist } = reading;

  // ── Temperature ────────────────────────────────────────────────────────────
  if (temp != null && temp > THRESHOLDS.TEMP_WARNING_C) {
    if (!s.temperature.abnormal_since) s.temperature.abnormal_since = now;
    const duration = now - s.temperature.abnormal_since!;
    const isDanger = temp > THRESHOLDS.TEMP_DANGER_C;

    if (duration >= THRESHOLDS.TEMP_DURATION_MS && !recentlyAlerted(s.temperature, now)) {
      alerts.push(isDanger
        ? { type: 'danger',  category: 'temperature', message: `Temperature critically high: ${temp.toFixed(1)} °C (threshold: ${THRESHOLDS.TEMP_DANGER_C} °C)` }
        : { type: 'warning', category: 'temperature', message: `Temperature elevated: ${temp.toFixed(1)} °C (threshold: ${THRESHOLDS.TEMP_WARNING_C} °C)` });
      s.temperature.last_alerted_at = now;
    }
    if (isDanger && status !== 'critical') status = 'danger';
    else if (status === 'normal') status = 'warning';
  } else {
    s.temperature.abnormal_since = null;
  }

  // ── Smoke / Gas ────────────────────────────────────────────────────────────
  const smokeHigh    = smoke != null && smoke > THRESHOLDS.SMOKE_LEVEL;
  const tempElevated = temp  != null && temp  > THRESHOLDS.TEMP_WARNING_C;

  if (smokeHigh) {
    if (!s.smoke.abnormal_since) s.smoke.abnormal_since = now;
    const duration = now - s.smoke.abnormal_since!;

    if (duration >= THRESHOLDS.SMOKE_DURATION_MS && !recentlyAlerted(s.smoke, now)) {
      if (tempElevated) {
        alerts.push({ type: 'critical', category: 'smoke',
          message: `Fire hazard! Smoke: ${smoke!.toFixed(0)} + temperature: ${temp!.toFixed(1)} °C` });
        status = 'critical';
      } else {
        alerts.push({ type: 'danger', category: 'smoke',
          message: `Smoke / gas detected! Level: ${smoke!.toFixed(0)} (threshold: ${THRESHOLDS.SMOKE_LEVEL})` });
        if (status !== 'critical') status = 'danger';
      }
      s.smoke.last_alerted_at = now;
    }
    if (smokeHigh && tempElevated) status = 'critical';
    else if (status !== 'critical') status = 'danger';
  } else {
    s.smoke.abnormal_since = null;
  }

  // ── Overload ───────────────────────────────────────────────────────────────
  if (weight != null && weight > THRESHOLDS.OVERLOAD_KG) {
    if (!s.overload.abnormal_since) s.overload.abnormal_since = now;
    const duration = now - s.overload.abnormal_since!;

    if (duration >= THRESHOLDS.OVERLOAD_DURATION_MS && !recentlyAlerted(s.overload, now)) {
      alerts.push({ type: 'critical', category: 'overload',
        message: `Elevator overloaded! Weight: ${weight.toFixed(1)} kg (max: ${THRESHOLDS.OVERLOAD_KG} kg)` });
      s.overload.last_alerted_at = now;
    }
    status = 'critical';
  } else {
    s.overload.abnormal_since = null;
  }

  // ── Stuck Between Floors ───────────────────────────────────────────────────
  const floor          = computeFloor(dist, calibration);
  const isBetweenFloors = floor === -1;
  const lastDist        = s.stuck.last_distance;
  const isStationary    = lastDist != null && dist != null && Math.abs(dist - lastDist) <= THRESHOLDS.STUCK_TOLERANCE_CM;
  const is_moving       = !isStationary;

  if (!isStationary) {
    s.stuck.last_moved_at   = now;
    s.stuck.abnormal_since  = null;
  }
  s.stuck.last_distance = dist ?? lastDist;

  if (isStationary && isBetweenFloors) {
    if (!s.stuck.abnormal_since) s.stuck.abnormal_since = now;
    const duration = now - s.stuck.abnormal_since!;

    if (duration >= THRESHOLDS.STUCK_DURATION_MS && !recentlyAlerted(s.stuck, now)) {
      alerts.push({ type: 'critical', category: 'stuck',
        message: `Elevator stuck between floors! Position: ${dist?.toFixed(1) ?? '?'} cm — stationary for ${Math.round(duration / 1000)} s` });
      s.stuck.last_alerted_at = now;
      status = 'critical';
    }
    if (s.stuck.abnormal_since && (now - s.stuck.abnormal_since) >= THRESHOLDS.STUCK_DURATION_MS) {
      status = 'critical';
    }
  } else if (!isBetweenFloors) {
    s.stuck.abnormal_since = null;
  }

  return { alerts, updatedState: s, status, floor, is_moving };
}
