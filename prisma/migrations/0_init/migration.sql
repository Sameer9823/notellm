-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('PDF', 'TEXT', 'URL', 'YOUTUBE', 'VTT');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('UPLOADING', 'QUEUED', 'INDEXING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "AudioStatus" AS ENUM ('QUEUED', 'SCRIPTING', 'SYNTHESIZING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RoadmapStatus" AS ENUM ('QUEUED', 'CLUSTERING', 'LABELING', 'ORDERING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('SUMMARY', 'TAKEAWAYS', 'FLASHCARDS', 'QUIZ', 'MINDMAP', 'REPORT');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewGrade" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateEnum
CREATE TYPE "ReviewCardType" AS ENUM ('FLASHCARD', 'QUIZ');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('MANUAL', 'LEARNED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'UNPAID');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('SIGNUP_BONUS', 'PURCHASE', 'SUBSCRIPTION_GRANT', 'USAGE', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Notebook" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled notebook',
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'notebook',
    "color" TEXT NOT NULL DEFAULT 'violet',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "shareSlug" TEXT,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCredits" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 200,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredits_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roadmap" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "status" "RoadmapStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "nodes" JSONB,
    "edges" JSONB,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Roadmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioOverview" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceTitle" TEXT,
    "status" "AudioStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "script" JSONB,
    "audioData" BYTEA,
    "audioUrl" TEXT,
    "audioPublicId" TEXT,
    "durationSec" INTEGER,
    "voiceA" TEXT NOT NULL DEFAULT 'alloy',
    "voiceB" TEXT NOT NULL DEFAULT 'onyx',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioOverview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'UPLOADING',
    "errorMessage" TEXT,
    "originUrl" TEXT,
    "storagePath" TEXT,
    "storagePublicId" TEXT,
    "rawText" TEXT,
    "snapshotUrl" TEXT,
    "snapshotPublicId" TEXT,
    "fileSizeBytes" INTEGER,
    "pageCount" INTEGER,
    "durationSec" INTEGER,
    "language" TEXT,
    "metadata" JSONB,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "indexedAt" TIMESTAMP(3),

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFile" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "startChar" INTEGER,
    "endChar" INTEGER,
    "page" INTEGER,
    "startSec" INTEGER,
    "endSec" INTEGER,
    "vectorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "channel" "MessageChannel" NOT NULL DEFAULT 'TEXT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "type" "ArtifactType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ArtifactStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "sourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "cardIndex" INTEGER NOT NULL,
    "cardType" "ReviewCardType" NOT NULL DEFAULT 'FLASHCARD',
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correctIndex" INTEGER,
    "explanation" TEXT,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" TIMESTAMP(3),
    "lastGrade" "ReviewGrade",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "grade" "ReviewGrade" NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memory" TEXT NOT NULL,
    "source" "MemorySource" NOT NULL DEFAULT 'MANUAL',
    "metadata" JSONB,
    "vectorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedStripeEvent" (
    "id" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notebook_shareSlug_key" ON "Notebook"("shareSlug");

-- CreateIndex
CREATE INDEX "Notebook_ownerId_updatedAt_idx" ON "Notebook"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Note_notebookId_createdAt_idx" ON "Note"("notebookId", "createdAt");

-- CreateIndex
CREATE INDEX "Roadmap_notebookId_createdAt_idx" ON "Roadmap"("notebookId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioOverview_notebookId_createdAt_idx" ON "AudioOverview"("notebookId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioOverview_notebookId_sourceId_idx" ON "AudioOverview"("notebookId", "sourceId");

-- CreateIndex
CREATE INDEX "Source_notebookId_idx" ON "Source"("notebookId");

-- CreateIndex
CREATE INDEX "Source_status_idx" ON "Source"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFile_sourceId_key" ON "SourceFile"("sourceId");

-- CreateIndex
CREATE INDEX "SourceFile_sourceId_idx" ON "SourceFile"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_vectorId_key" ON "Chunk"("vectorId");

-- CreateIndex
CREATE INDEX "Chunk_sourceId_idx" ON "Chunk"("sourceId");

-- CreateIndex
CREATE INDEX "Chunk_notebookId_idx" ON "Chunk"("notebookId");

-- CreateIndex
CREATE INDEX "Message_notebookId_createdAt_idx" ON "Message"("notebookId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_notebookId_createdAt_idx" ON "Artifact"("notebookId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_notebookId_type_idx" ON "Artifact"("notebookId", "type");

-- CreateIndex
CREATE INDEX "ReviewCard_userId_dueAt_idx" ON "ReviewCard"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "ReviewCard_notebookId_idx" ON "ReviewCard"("notebookId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCard_artifactId_cardIndex_key" ON "ReviewCard"("artifactId", "cardIndex");

-- CreateIndex
CREATE INDEX "ReviewLog_userId_reviewedAt_idx" ON "ReviewLog"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "UserMemory_userId_updatedAt_idx" ON "UserMemory"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_userId_key" ON "StripeCustomer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_stripeCustomerId_key" ON "StripeCustomer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_idx" ON "CreditTransaction"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roadmap" ADD CONSTRAINT "Roadmap_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioOverview" ADD CONSTRAINT "AudioOverview_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "ReviewCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

