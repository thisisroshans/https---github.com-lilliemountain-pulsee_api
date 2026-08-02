-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('LOSE_WEIGHT', 'BUILD_MUSCLE', 'GET_TONED', 'LOSE_BELLY_FAT', 'STAMINA_ENERGY', 'MANAGE_CONDITION');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'VERY_ACTIVE');

-- CreateEnum
CREATE TYPE "TargetDeadline" AS ENUM ('ONE_MONTH', 'TWO_MONTHS', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR');

-- CreateEnum
CREATE TYPE "HeightUnit" AS ENUM ('CM', 'FT_IN');

-- CreateEnum
CREATE TYPE "WeightUnit" AS ENUM ('KG', 'LB');

-- CreateEnum
CREATE TYPE "HealthCondition" AS ENUM ('PCOS', 'DIABETES_TYPE_2', 'PRE_DIABETES', 'HYPERTENSION', 'THYROID', 'HIGH_CHOLESTEROL', 'IBS_DIGESTIVE');

-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('LACTOSE', 'GLUTEN', 'NUTS', 'EGGS', 'SHELLFISH', 'SOY');

-- CreateEnum
CREATE TYPE "DietType" AS ENUM ('VEGETARIAN', 'EGGETARIAN', 'NON_VEGETARIAN', 'VEGAN', 'JAIN');

-- CreateEnum
CREATE TYPE "BudgetTier" AS ENUM ('LOW', 'MID', 'HIGH');

-- CreateEnum
CREATE TYPE "CookingResponsibility" AS ENUM ('SELF', 'HOUSEHOLD', 'ORDER_IN', 'MIXED');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "WorkoutLocation" AS ENUM ('HOME_NO_EQUIPMENT', 'HOME_BASIC_EQUIPMENT', 'GYM', 'YOGA_PILATES', 'OUTDOOR');

-- CreateEnum
CREATE TYPE "PreferredTime" AS ENUM ('EARLY_MORNING', 'MORNING', 'LUNCH', 'EVENING', 'NIGHT');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER', 'SOME', 'ADVANCED');

-- CreateEnum
CREATE TYPE "SupplementKind" AS ENUM ('PROTEIN', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboarding_completed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "sex" "Sex" NOT NULL,
    "age_years" INTEGER NOT NULL,
    "height_cm" DOUBLE PRECISION NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,
    "target_weight_kg" DOUBLE PRECISION NOT NULL,
    "target_deadline" "TargetDeadline" NOT NULL,
    "activity_level" "ActivityLevel" NOT NULL,
    "height_unit" "HeightUnit" NOT NULL DEFAULT 'CM',
    "weight_unit" "WeightUnit" NOT NULL DEFAULT 'KG',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "GoalType" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_profiles" (
    "user_id" UUID NOT NULL,
    "conditions" "HealthCondition"[],
    "allergies" "Allergen"[],
    "medications" VARCHAR(500),
    "tracks_cycle" BOOLEAN NOT NULL DEFAULT false,
    "pregnant_or_nursing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "diet_preferences" (
    "user_id" UUID NOT NULL,
    "diet_type" "DietType" NOT NULL,
    "cuisines" TEXT[],
    "dislikes" TEXT[],
    "budget_tier" "BudgetTier" NOT NULL,
    "cooked_by" "CookingResponsibility" NOT NULL,
    "cooking_minutes" INTEGER NOT NULL,
    "veg_only_days" "Weekday"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "diet_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "supplements" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "SupplementKind" NOT NULL,
    "default_protein_per_serving_g" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_supplements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supplement_id" UUID NOT NULL,
    "protein_per_serving_g" INTEGER NOT NULL,
    "servings_per_day" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_supplements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_preferences" (
    "user_id" UUID NOT NULL,
    "locations" "WorkoutLocation"[],
    "days_per_week" INTEGER NOT NULL,
    "session_minutes" INTEGER NOT NULL,
    "preferred_time" "PreferredTime" NOT NULL,
    "experience_level" "ExperienceLevel" NOT NULL,
    "injuries" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workout_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "user_goals_user_id_idx" ON "user_goals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_goals_user_id_type_key" ON "user_goals"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "supplements_slug_key" ON "supplements"("slug");

-- CreateIndex
CREATE INDEX "supplements_is_active_sort_order_idx" ON "supplements"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "user_supplements_user_id_idx" ON "user_supplements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_supplements_user_id_supplement_id_key" ON "user_supplements"("user_id", "supplement_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_profiles" ADD CONSTRAINT "health_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_preferences" ADD CONSTRAINT "diet_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_supplements" ADD CONSTRAINT "user_supplements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_supplements" ADD CONSTRAINT "user_supplements_supplement_id_fkey" FOREIGN KEY ("supplement_id") REFERENCES "supplements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_preferences" ADD CONSTRAINT "workout_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

