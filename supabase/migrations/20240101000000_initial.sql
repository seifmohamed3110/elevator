-- ── Smart Elevator Monitor — Initial Database Schema ─────────────────────────

-- Sensor readings (replaces Firebase Realtime DB sensor_data/history + latest)
CREATE TABLE sensor_readings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  temperature REAL,
  smoke_level REAL,
  weight      REAL,
  distance    REAL,
  floor       INTEGER     DEFAULT -1,
  is_moving   BOOLEAN     DEFAULT FALSE,
  status      TEXT        DEFAULT 'normal'
                          CHECK (status IN ('normal', 'warning', 'danger', 'critical')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Alerts (replaces Firestore alerts collection)
CREATE TABLE alerts (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  type          TEXT        NOT NULL CHECK (type IN ('warning', 'danger', 'critical')),
  category      TEXT        NOT NULL CHECK (category IN ('temperature', 'smoke', 'overload', 'stuck')),
  message       TEXT        NOT NULL,
  sensor_values JSONB,
  floor         INTEGER     DEFAULT -1,
  acknowledged  BOOLEAN     DEFAULT FALSE,
  email_sent    BOOLEAN     DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Detection state (replaces Firebase Realtime DB detection_state — single row)
CREATE TABLE detection_state (
  id         INTEGER     PRIMARY KEY DEFAULT 1,
  state      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO detection_state (state) VALUES ('{}');

-- Floor calibration (replaces Firebase Realtime DB calibration node)
CREATE TABLE floor_calibration (
  floor_number INTEGER PRIMARY KEY,
  min_distance REAL    NOT NULL,
  max_distance REAL    NOT NULL,
  label        TEXT    NOT NULL
);
INSERT INTO floor_calibration VALUES (0,   0,  30, 'Ground Floor');
INSERT INTO floor_calibration VALUES (1, 100, 130, 'Floor 1');
INSERT INTO floor_calibration VALUES (2, 200, 230, 'Floor 2');

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_sensor_readings_created_at ON sensor_readings (created_at DESC);
CREATE INDEX idx_alerts_created_at          ON alerts           (created_at DESC);
CREATE INDEX idx_alerts_acknowledged        ON alerts           (acknowledged);

-- ── Enable Realtime subscriptions ─────────────────────────────────────────────
-- NOTE: Also enable these tables in Supabase Dashboard → Database → Replication
ALTER PUBLICATION supabase_realtime ADD TABLE sensor_readings;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE sensor_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_calibration ENABLE ROW LEVEL SECURITY;

-- sensor_readings: public read only (Edge Function writes with service_role)
CREATE POLICY "public read" ON sensor_readings FOR SELECT USING (true);

-- alerts: public read + public update for acknowledge button
CREATE POLICY "public read"   ON alerts FOR SELECT USING (true);
CREATE POLICY "public update" ON alerts FOR UPDATE USING (true) WITH CHECK (true);

-- floor_calibration: public read
CREATE POLICY "public read" ON floor_calibration FOR SELECT USING (true);

-- detection_state: no public access — only Edge Function (service_role) can read/write
