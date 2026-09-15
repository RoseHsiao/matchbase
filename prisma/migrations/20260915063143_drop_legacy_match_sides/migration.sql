/*
  Warnings:

  - You are about to drop the column `awayScore` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `awayTeamId` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `homeScore` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `homeTeamId` on the `Match` table. All the data in the column will be lost.

*/

-- Safety guard: refuse to drop the legacy columns unless every legacy side and
-- score is mirrored by MatchParticipant rows / sideAScore / sideBScore. A failed
-- assertion rolls the whole migration back and leaves the legacy data in place.
DO $$
DECLARE
  missing_sides integer;
  score_mismatch integer;
BEGIN
  SELECT count(*) INTO missing_sides
  FROM "Match" m
  WHERE (m."homeTeamId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "MatchParticipant" p WHERE p."matchId" = m."id" AND p."side" = 'A' AND p."order" = 1 AND p."teamId" = m."homeTeamId"))
     OR (m."awayTeamId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "MatchParticipant" p WHERE p."matchId" = m."id" AND p."side" = 'B' AND p."order" = 1 AND p."teamId" = m."awayTeamId"));
  IF missing_sides > 0 THEN
    RAISE EXCEPTION 'drop_legacy_match_sides: % matches have legacy team sides without matching participants', missing_sides;
  END IF;

  SELECT count(*) INTO score_mismatch
  FROM "Match" m
  WHERE m."homeScore" IS DISTINCT FROM m."sideAScore" OR m."awayScore" IS DISTINCT FROM m."sideBScore";
  IF score_mismatch > 0 THEN
    RAISE EXCEPTION 'drop_legacy_match_sides: % matches have legacy scores that differ from side scores', score_mismatch;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_awayTeamId_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_homeTeamId_fkey";

-- DropIndex
DROP INDEX "Match_awayTeamId_startsAt_idx";

-- DropIndex
DROP INDEX "Match_homeTeamId_startsAt_idx";

-- AlterTable
ALTER TABLE "Match" DROP COLUMN "awayScore",
DROP COLUMN "awayTeamId",
DROP COLUMN "homeScore",
DROP COLUMN "homeTeamId";
