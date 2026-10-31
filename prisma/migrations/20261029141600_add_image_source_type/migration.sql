-- Add IMAGE to the SourceType enum. Existing rows are unaffected; the
-- new value is only used when a user uploads an image source.
ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'IMAGE';
