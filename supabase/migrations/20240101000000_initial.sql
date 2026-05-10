-- ── Smart Elevator Monitor — Initial Database Schema ─────────────────────────

-- Sensor readings
CREATE TABLE IF NOT EXISTS sensor_readings (
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

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
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

-- Detection state (single row)
CREATE TABLE IF NOT EXISTS detection_state (
  id         INTEGER     PRIMARY KEY DEFAULT 1,
  state      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO detection_state (id, state)
VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;

-- Floor calibration
CREATE TABLE IF NOT EXISTS floor_calibration (
  floor_number INTEGER PRIMARY KEY,
  min_distance REAL    NOT NULL,
  max_distance REAL    NOT NULL,
  label        TEXT    NOT NULL
);
INSERT INTO floor_calibration (floor_number, min_distance, max_distance, label) VALUES
  (0,   0,  30, 'Ground Floor'),
  (1, 100, 130, 'Floor 1'),
  (2, 200, 230, 'Floor 2')
ON CONFLICT (floor_number) DO NOTHING;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sensor_readings_created_at ON sensor_readings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at          ON alerts           (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged        ON alerts           (acknowledged);

-- ── Enable Realtime subscriptions ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sensor_readings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sensor_readings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
  END IF;
END $$;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE sensor_readings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_calibration ENABLE ROW LEVEL SECURITY;

-- sensor_readings: public read only
DROP POLICY IF EXISTS "public read" ON sensor_readings;
CREATE POLICY "public read" ON sensor_readings FOR SELECT USING (true);

-- alerts: public read + public update for acknowledge button
DROP POLICY IF EXISTS "public read"   ON alerts;
DROP POLICY IF EXISTS "public update" ON alerts;
CREATE POLICY "public read"   ON alerts FOR SELECT USING (true);
CREATE POLICY "public update" ON alerts FOR UPDATE USING (true) WITH CHECK (true);

-- floor_calibration: public read
DROP POLICY IF EXISTS "public read" ON floor_calibration;
CREATE POLICY "public read" ON floor_calibration FOR SELECT USING (true);

-- detection_state: no public access — only Edge Function (service_role) can read/write