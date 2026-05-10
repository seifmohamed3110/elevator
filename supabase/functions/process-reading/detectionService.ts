// detectionService.ts — TypeScript port of the original Node.js detection logic

import { sendAlertEmail } from './emailService.ts';

const THRESHOLDS = {
  TEMP_WARNING_C:       28,
  TEMP_DANGER_C:        32,
  TEMP_DURATION_MS:     10_000,
  SMOKE_LEVEL:          300,
  SMOKE_DURATION_MS:    10_000,
  OVERLOAD_KG:          270,
  OVERLOAD_DURATION_MS: 5_000, 
  STUCK_TOLERANCE_CM:   5,
  STUCK_DURATION_MS:    5_000,
  ALERT_COOLDOWN_MS:    20 * 1_000,
} as const;

/**
 * Valid floor positions (in cm).
 * If the elevator's distance reading falls inside one of these ranges,
 * it is considered to be safely AT that floor — NOT stuck.
 * Any distance outside ALL of these ranges means the elevator is
 * between floors and should trigger stuck detection if stationary.
 *
 * Layout:
 *   Ground floor : 0    cm –  5.5 cm   (floor 0)
 *   1st floor    : 5.5  cm –  7.5 cm   (floor 1)
 *   2nd floor    : 18.5 cm – 20.5 cm   (floor 2)
 *   3rd floor    : 29   cm – 31   cm   (floor 3)
 */
const FLOOR_RANGES: ReadonlyArray<{ floor: number; min: number; max: number; label: string }> = [
  { floor: 0, min:  0.0, max:  5.4, label: 'Ground floor' },
  { floor: 1, min:  5.5, max:  7.5, label: '1st floor'    },
  { floor: 2, min: 18.5, max: 20.5, label: '2nd floor'    },
  { floor: 3, min: 29.0, max: 31.0, label: '3rd floor'    },
];

/**
 * Returns the floor number if `distance` is within a known floor range,
 * or -1 if the elevator is between floors (i.e. stuck candidate).
 */
function getFloorFromDistance(distance: number | null): number {
  if (distance == null) return -1;
  for (const range of FLOOR_RANGES) {
    if (distance >= range.min && distance <= range.max) {
      return range.floor;
    }
  }
  return -1; // between floors → stuck
}

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
  status:       Status;
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

// NOTE: computeFloor via external calibration is kept for any other callers,
// but stuck detection now uses the built-in FLOOR_RANGES via getFloorFromDistance.
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

type Status = 'normal' | 'warning' | 'danger' | 'critical';
const SEVERITY: Record<Status, number> = { normal: 0, warning: 1, danger: 2, critical: 3 };

/** Upgrades `current` to `next` only if `next` is more severe. */
function escalate(current: Status, next: Status): Status {
  return SEVERITY[next] > SEVERITY[current] ? next : current;
}

export async function evaluate(
  reading:     SensorReading,
  state:       DetectionState,
  calibration: Record<string, FloorRange>,
  now:         number,
): Promise<EvaluateResult> {
  const alerts: AlertEntry[] = [];
  const s: DetectionState = JSON.parse(JSON.stringify(state));
  let status: Status = 'normal';

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
    status = escalate(status, isDanger ? 'danger' : 'warning');
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
        status = escalate(status, 'critical');
      } else {
        alerts.push({ type: 'danger', category: 'smoke',
          message: `Smoke / gas detected! Level: ${smoke!.toFixed(0)} (threshold: ${THRESHOLDS.SMOKE_LEVEL})` });
        status = escalate(status, 'danger');
      }
      s.smoke.last_alerted_at = now;
    }
    status = escalate(status, smokeHigh && tempElevated ? 'critical' : 'danger');
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
    status = escalate(status, 'critical');
  } else {
    s.overload.abnormal_since = null;
  }

  // ── Stuck Between Floors ───────────────────────────────────────────────────
  //
  // The elevator is considered AT a floor when its distance falls inside one
  // of the FLOOR_RANGES defined above. Any reading outside ALL ranges means
  // it is between floors — if it is also stationary there for longer than
  // STUCK_DURATION_MS, a critical alert fires.
  //
  const floor           = getFloorFromDistance(dist); // -1 = between floors
  const isBetweenFloors = floor === -1;

  const lastDist     = s.stuck.last_distance;
  const isStationary =
    lastDist != null &&
    dist     != null &&
    Math.abs(dist - lastDist) <= THRESHOLDS.STUCK_TOLERANCE_CM;
  const is_moving = !isStationary;

  if (!isStationary) {
    // Elevator moved — reset stuck tracking
    s.stuck.last_moved_at  = now;
    s.stuck.abnormal_since = null;
  }
  s.stuck.last_distance = dist ?? lastDist;

  if (isStationary && isBetweenFloors) {
    // Stationary AND outside every valid floor range → stuck
    if (!s.stuck.abnormal_since) s.stuck.abnormal_since = now;
    const duration = now - s.stuck.abnormal_since!;

    if (duration >= THRESHOLDS.STUCK_DURATION_MS && !recentlyAlerted(s.stuck, now)) {
      const stuckAlert: AlertEntry = {
        type:     'critical',
        category: 'stuck',
        message:  `Elevator stuck between floors! Position: ${dist?.toFixed(1) ?? '?'} cm — stationary for ${Math.round(duration / 1_000)} s`,
      };
      alerts.push(stuckAlert);
      s.stuck.last_alerted_at = now;
      status = escalate(status, 'critical');

      // Send email notification — fire-and-forget, don't block the result
      sendAlertEmail(stuckAlert, { ...reading, floor }).catch((err) =>
        console.error('Failed to send stuck alert email:', err),
      );
    }

    // Escalate status as soon as the duration threshold is crossed
    if (s.stuck.abnormal_since && (now - s.stuck.abnormal_since) >= THRESHOLDS.STUCK_DURATION_MS) {
      status = escalate(status, 'critical');
    }
  } else {
    // Moving, OR sitting inside a valid floor range → not stuck
    s.stuck.abnormal_since = null;
  }

  return { alerts, updatedState: s, status, floor, is_moving };
}