-- Item photos for purchasing orders. Files live in the Supabase Storage bucket
-- "purchasing-photos" (public read, created via the storage API). This table is
-- the source of truth + soft-delete: deleting sets deleted_at (the file stays in
-- the bucket, so a delete is recoverable/restorable from the front end).
CREATE TABLE IF NOT EXISTS purchasing_photos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL,
  storage_path text NOT NULL,       -- path within the purchasing-photos bucket
  original_name text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz            -- soft delete; file remains in storage
);

CREATE INDEX IF NOT EXISTS idx_purchasing_photos_order ON purchasing_photos(order_id);

ALTER TABLE purchasing_photos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchasing_photos_service_full') THEN
    CREATE POLICY purchasing_photos_service_full ON purchasing_photos FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
