-- CreateEnum
CREATE TYPE "WeightSource" AS ENUM ('MANUAL', 'SCALE', 'IMPORT');

-- CreateTable
CREATE TABLE "weight_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "local_date" VARCHAR(10) NOT NULL,
    "source" "WeightSource" NOT NULL DEFAULT 'MANUAL',
    "note" VARCHAR(280),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weight_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weight_entries_user_id_recorded_at_idx" ON "weight_entries"("user_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "weight_entries_user_id_local_date_key" ON "weight_entries"("user_id", "local_date");

-- AddForeignKey
ALTER TABLE "weight_entries" ADD CONSTRAINT "weight_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

