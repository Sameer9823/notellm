-- AlterTable: optional Cloudinary storage for original source files.
-- storagePath already existed (unused) — repurposed as the Cloudinary
-- secure_url; storagePublicId is new, needed to delete the asset later.
ALTER TABLE "Source" ADD COLUMN "storagePublicId" TEXT;

-- AlterTable: optional Cloudinary storage for generated podcast audio.
-- audioData (Bytes) is kept for backward compatibility with rows created
-- before this migration and as a fallback when Cloudinary isn't configured.
ALTER TABLE "AudioOverview" ADD COLUMN "audioUrl" TEXT;
ALTER TABLE "AudioOverview" ADD COLUMN "audioPublicId" TEXT;
