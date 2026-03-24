-- Add separate photo columns for different categories
ALTER TABLE pallet_records
ADD COLUMN IF NOT EXISTS shipment_photo_urls jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS work_paper_photo_urls jsonb DEFAULT '[]'::jsonb;
