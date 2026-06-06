-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'NORMALIZING', 'NORMALIZED', 'MATCHING', 'MATCHED', 'IN_REVIEW', 'READY', 'PREVIEWED', 'COMMITTING', 'COMMITTED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PRODUCT', 'BOOKING', 'TRAVELER', 'GUIDE', 'QUALIFICATION', 'STAFFING_RULE');

-- CreateEnum
CREATE TYPE "CanonicalStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'CANDIDATE', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MatchTargetKind" AS ENUM ('EXISTING_PLATFORM', 'INTRA_BATCH');

-- CreateEnum
CREATE TYPE "ReviewReason" AS ENUM ('LOW_CONFIDENCE', 'CONFLICT', 'DUPLICATE', 'VALIDATION_ERROR');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReviewResolution" AS ENUM ('ACCEPT', 'REJECT', 'REMAP', 'MERGE', 'EDIT');

-- CreateEnum
CREATE TYPE "PublishOp" AS ENUM ('CREATE', 'UPDATE', 'LINK', 'DEACTIVATE');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('PLANNED', 'COMMITTED', 'FAILED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "MigrationSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operatorRef" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceConnection" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mappingConfig" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceConnectionId" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "entityTypes" "EntityType"[],
    "counts" JSONB NOT NULL DEFAULT '{}',
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawArtifact" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "sourceRowIndex" INTEGER NOT NULL,
    "sheetName" TEXT,
    "rawData" JSONB NOT NULL,
    "parseErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "sourceRecordId" TEXT,
    "status" "CanonicalStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "externalId" TEXT,
    "keyEmail" TEXT,
    "keyCode" TEXT,
    "keyName" TEXT,
    "keyDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCandidate" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "canonicalRecordId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "targetKind" "MatchTargetKind" NOT NULL,
    "targetExternalId" TEXT,
    "targetRecordId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "strategy" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'CANDIDATE',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "canonicalRecordId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "reason" "ReviewReason" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "ReviewResolution",
    "resolvedBy" TEXT,
    "resolutionData" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAction" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "canonicalRecordId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "op" "PublishOp" NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'PLANNED',
    "sequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "targetExternalId" TEXT,
    "resultExternalId" TEXT,
    "response" JSONB,
    "error" JSONB,
    "compensationOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationSession_status_idx" ON "MigrationSession"("status");

-- CreateIndex
CREATE INDEX "SourceConnection_sessionId_idx" ON "SourceConnection"("sessionId");

-- CreateIndex
CREATE INDEX "ImportBatch_sessionId_idx" ON "ImportBatch"("sessionId");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "RawArtifact_batchId_idx" ON "RawArtifact"("batchId");

-- CreateIndex
CREATE INDEX "RawArtifact_contentHash_idx" ON "RawArtifact"("contentHash");

-- CreateIndex
CREATE INDEX "ExtractedRecord_batchId_entityType_idx" ON "ExtractedRecord"("batchId", "entityType");

-- CreateIndex
CREATE INDEX "CanonicalRecord_batchId_entityType_status_idx" ON "CanonicalRecord"("batchId", "entityType", "status");

-- CreateIndex
CREATE INDEX "CanonicalRecord_entityType_dedupeKey_idx" ON "CanonicalRecord"("entityType", "dedupeKey");

-- CreateIndex
CREATE INDEX "CanonicalRecord_entityType_keyEmail_idx" ON "CanonicalRecord"("entityType", "keyEmail");

-- CreateIndex
CREATE INDEX "CanonicalRecord_entityType_keyCode_idx" ON "CanonicalRecord"("entityType", "keyCode");

-- CreateIndex
CREATE INDEX "MatchCandidate_batchId_entityType_status_idx" ON "MatchCandidate"("batchId", "entityType", "status");

-- CreateIndex
CREATE INDEX "MatchCandidate_canonicalRecordId_idx" ON "MatchCandidate"("canonicalRecordId");

-- CreateIndex
CREATE INDEX "ReviewItem_batchId_status_idx" ON "ReviewItem"("batchId", "status");

-- CreateIndex
CREATE INDEX "ReviewItem_canonicalRecordId_idx" ON "ReviewItem"("canonicalRecordId");

-- CreateIndex
CREATE INDEX "PublishAction_batchId_status_idx" ON "PublishAction"("batchId", "status");

-- CreateIndex
CREATE INDEX "PublishAction_batchId_sequence_idx" ON "PublishAction"("batchId", "sequence");

-- AddForeignKey
ALTER TABLE "SourceConnection" ADD CONSTRAINT "SourceConnection_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MigrationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MigrationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_sourceConnectionId_fkey" FOREIGN KEY ("sourceConnectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawArtifact" ADD CONSTRAINT "RawArtifact_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedRecord" ADD CONSTRAINT "ExtractedRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalRecord" ADD CONSTRAINT "CanonicalRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalRecord" ADD CONSTRAINT "CanonicalRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MigrationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalRecord" ADD CONSTRAINT "CanonicalRecord_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "ExtractedRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_canonicalRecordId_fkey" FOREIGN KEY ("canonicalRecordId") REFERENCES "CanonicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_canonicalRecordId_fkey" FOREIGN KEY ("canonicalRecordId") REFERENCES "CanonicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAction" ADD CONSTRAINT "PublishAction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAction" ADD CONSTRAINT "PublishAction_canonicalRecordId_fkey" FOREIGN KEY ("canonicalRecordId") REFERENCES "CanonicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAction" ADD CONSTRAINT "PublishAction_compensationOf_fkey" FOREIGN KEY ("compensationOf") REFERENCES "PublishAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
