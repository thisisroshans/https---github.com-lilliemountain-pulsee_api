-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "replaced_by_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "firebase_uid" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

