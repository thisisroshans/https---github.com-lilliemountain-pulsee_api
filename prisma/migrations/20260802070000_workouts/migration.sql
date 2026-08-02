-- CreateEnum
CREATE TYPE "MuscleGroup" AS ENUM ('CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'FOREARMS', 'ABS', 'OBLIQUES', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'LATS', 'TRAPS', 'LOWER_BACK', 'REAR_DELTS', 'FULL_BODY', 'CARDIO');

-- CreateEnum
CREATE TYPE "ExerciseCategory" AS ENUM ('PUSH', 'PULL', 'LEGS', 'CORE', 'CARDIO', 'MOBILITY');

-- CreateEnum
CREATE TYPE "Equipment" AS ENUM ('NONE', 'DUMBBELL', 'BARBELL', 'MACHINE', 'CABLE', 'KETTLEBELL', 'RESISTANCE_BAND', 'BODYWEIGHT', 'CARDIO_MACHINE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "ExerciseCategory" NOT NULL,
    "primary_muscles" "MuscleGroup"[],
    "secondary_muscles" "MuscleGroup"[],
    "equipment" "Equipment"[],
    "how_to_steps" TEXT[],
    "demo_video_key" VARCHAR(255),
    "is_weighted" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "title" VARCHAR(120),
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "perceived_exertion" INTEGER,
    "notes" VARCHAR(1000),
    "local_date" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_logs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "set_number" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "weight_kg" DOUBLE PRECISION,
    "duration_seconds" INTEGER,
    "is_warmup" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "set_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exercises_slug_key" ON "exercises"("slug");

-- CreateIndex
CREATE INDEX "exercises_is_active_sort_order_idx" ON "exercises"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "exercises_category_idx" ON "exercises"("category");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_started_at_idx" ON "workout_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_local_date_idx" ON "workout_sessions"("user_id", "local_date");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_status_idx" ON "workout_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "set_logs_user_id_exercise_id_created_at_idx" ON "set_logs"("user_id", "exercise_id", "created_at");

-- CreateIndex
CREATE INDEX "set_logs_session_id_idx" ON "set_logs"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "set_logs_session_id_exercise_id_set_number_key" ON "set_logs"("session_id", "exercise_id", "set_number");

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

