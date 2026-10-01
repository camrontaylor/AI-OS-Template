CREATE TABLE IF NOT EXISTS team_os_instance (
  singleton  boolean     PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  server_id  uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO team_os_instance (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;
