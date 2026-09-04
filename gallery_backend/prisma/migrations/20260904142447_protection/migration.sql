-- AlterTable
ALTER TABLE "images" ADD COLUMN     "rights" JSONB;

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "creator" VARCHAR(160) NOT NULL DEFAULT '',
ADD COLUMN     "credit_line" VARCHAR(200) NOT NULL DEFAULT '',
ADD COLUMN     "default_license_terms" VARCHAR(400) NOT NULL DEFAULT '',
ADD COLUMN     "licensor_url" VARCHAR(300) NOT NULL DEFAULT '',
ADD COLUMN     "rights_holder" VARCHAR(160) NOT NULL DEFAULT '',
ADD COLUMN     "rights_statement" VARCHAR(400) NOT NULL DEFAULT '',
ADD COLUMN     "watermark_asset_key" VARCHAR(255) NOT NULL DEFAULT '',
ADD COLUMN     "watermark_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
ADD COLUMN     "watermark_placement" VARCHAR(16) NOT NULL DEFAULT 'tiled',
ADD COLUMN     "watermark_text" VARCHAR(120) NOT NULL DEFAULT '';
