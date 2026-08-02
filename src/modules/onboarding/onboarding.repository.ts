import type {
  ActivityLevel,
  Allergen,
  BudgetTier,
  CookingResponsibility,
  DietPreference,
  DietType,
  ExperienceLevel,
  GoalType,
  HealthCondition,
  HealthProfile,
  HeightUnit,
  PreferredTime,
  Prisma,
  PrismaClient,
  Profile,
  Sex,
  Supplement,
  TargetDeadline,
  UserGoal,
  UserSupplement,
  Weekday,
  WeightUnit,
  WorkoutLocation,
  WorkoutPreference,
} from '@prisma/client';
import { uuidv7 } from 'uuidv7';

/**
 * All database access for onboarding. Section writes are full replacements, and
 * each is transactional so a screen never lands half-saved.
 */

export interface ProfileData {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  targetDeadline: TargetDeadline;
  activityLevel: ActivityLevel;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
}

export interface HealthData {
  conditions: HealthCondition[];
  allergies: Allergen[];
  medications: string | null;
  tracksCycle: boolean;
  pregnantOrNursing: boolean;
}

export interface DietData {
  dietType: DietType;
  cuisines: string[];
  dislikes: string[];
  budgetTier: BudgetTier;
  cookedBy: CookingResponsibility;
  cookingMinutes: number;
  vegOnlyDays: Weekday[];
}

export interface SupplementSelection {
  supplementId: string;
  proteinPerServingG: number;
  servingsPerDay: number;
}

export interface WorkoutData {
  locations: WorkoutLocation[];
  daysPerWeek: number;
  sessionMinutes: number;
  preferredTime: PreferredTime;
  experienceLevel: ExperienceLevel;
  injuries: string | null;
}

export type UserSupplementWithCatalog = UserSupplement & { supplement: Supplement };

export interface OnboardingSnapshot {
  onboardingCompletedAt: Date | null;
  goals: UserGoal[];
  profile: Profile | null;
  health: HealthProfile | null;
  diet: DietPreference | null;
  supplements: UserSupplementWithCatalog[];
  workout: WorkoutPreference | null;
}

export class OnboardingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Everything onboarding needs in one round trip. Assembling this client-side
   * would be five sequential requests against a database on another continent.
   */
  async findSnapshot(userId: string): Promise<OnboardingSnapshot | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        onboardingCompletedAt: true,
        goals: { orderBy: { createdAt: 'asc' } },
        profile: true,
        healthProfile: true,
        dietPreference: true,
        supplements: { include: { supplement: true }, orderBy: { createdAt: 'asc' } },
        workoutPreference: true,
      },
    });

    if (!user) return null;

    return {
      onboardingCompletedAt: user.onboardingCompletedAt,
      goals: user.goals,
      profile: user.profile,
      health: user.healthProfile,
      diet: user.dietPreference,
      supplements: user.supplements,
      workout: user.workoutPreference,
    };
  }

  /** Just the goals — validating a target weight does not need the whole snapshot. */
  async findGoalTypes(userId: string): Promise<GoalType[]> {
    const goals = await this.prisma.userGoal.findMany({
      where: { userId },
      select: { type: true },
    });
    return goals.map((goal) => goal.type);
  }

  /** Replaces the goal set. Delete-then-insert keeps it a true PUT. */
  async replaceGoals(userId: string, goals: GoalType[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userGoal.deleteMany({ where: { userId } }),
      this.prisma.userGoal.createMany({
        data: goals.map((type) => ({ id: uuidv7(), userId, type })),
      }),
    ]);
  }

  upsertProfile(userId: string, data: ProfileData): Promise<Profile> {
    return this.prisma.profile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  upsertHealth(userId: string, data: HealthData): Promise<HealthProfile> {
    return this.prisma.healthProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  /**
   * Diet preferences and the supplement stack move together: they are one
   * screen, so a partial save would leave the user looking at state we do not
   * actually hold.
   */
  async upsertDietWithSupplements(
    userId: string,
    diet: DietData,
    supplements: SupplementSelection[],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.dietPreference.upsert({
        where: { userId },
        update: diet,
        create: { userId, ...diet },
      }),
      this.prisma.userSupplement.deleteMany({ where: { userId } }),
      this.prisma.userSupplement.createMany({
        data: supplements.map((entry) => ({
          id: uuidv7(),
          userId,
          supplementId: entry.supplementId,
          proteinPerServingG: entry.proteinPerServingG,
          servingsPerDay: entry.servingsPerDay,
        })),
      }),
    ]);
  }

  upsertWorkout(userId: string, data: WorkoutData): Promise<WorkoutPreference> {
    return this.prisma.workoutPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  markOnboardingComplete(userId: string, completedAt: Date): Promise<{ id: string }> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: completedAt },
      select: { id: true },
    });
  }

  /** Active catalog entries, ordered for display. */
  findActiveSupplements(): Promise<Supplement[]> {
    return this.prisma.supplement.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Used to reject a stack referencing unknown or retired supplements. */
  findSupplementsByIds(ids: string[]): Promise<Supplement[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.supplement.findMany({ where: { id: { in: ids }, isActive: true } });
  }

  async writeAudit(entry: {
    actorUserId: string;
    action: string;
    entity: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: uuidv7(),
        actorUserId: entry.actorUserId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      },
    });
  }
}
