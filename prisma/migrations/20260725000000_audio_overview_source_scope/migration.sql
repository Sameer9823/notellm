-- AlterTable: allow an AudioOverview to be scoped to a single source
-- (NULL = generated from all ready sources in the notebook, as before).
ALTER TABLE "AudioOverview" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "AudioOverview" ADD COLUMN "sourceTitle" TEXT;

-- CreateIndex
CREATE INDEX "AudioOverview_notebookId_sourceId_idx" ON "AudioOverview"("notebookId", "sourceId");
