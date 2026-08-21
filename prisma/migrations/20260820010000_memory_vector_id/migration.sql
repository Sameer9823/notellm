-- AlterTable: link each UserMemory row to its embedding in the Qdrant
-- `user_memories` collection (src/lib/qdrant.ts). NULL for rows created
-- before this migration or if embedding failed — getMemoryContext falls
-- back to a recency-ordered query for those.
ALTER TABLE "UserMemory" ADD COLUMN "vectorId" TEXT;
