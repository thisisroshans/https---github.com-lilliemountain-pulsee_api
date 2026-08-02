import type { Prisma, PrismaClient, WeightEntry, WeightSource } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

import type { Cursor } from '../../shared/http/pagination.js';

export interface RecordWeightData {
  userId: string;
  weightKg: number;
  localDate: string;
  recordedAt: Date;
  source: WeightSource;
  note: string | null;
}

export class ProgressRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** One weigh-in per local day; a repeat submission corrects that day. */
  upsertWeight(data: RecordWeightData): Promise<WeightEntry> {
    const payload = {
      weightKg: data.weightKg,
      recordedAt: data.recordedAt,
      source: data.source,
      note: data.note,
    };

    return this.prisma.weightEntry.upsert({
      where: { userId_localDate: { userId: data.userId, localDate: data.localDate } },
      update: payload,
      create: { id: uuidv7(), userId: data.userId, localDate: data.localDate, ...payload },
    });
  }

  findWeightPage(userId: string, limit: number, cursor: Cursor | undefined): Promise<WeightEntry[]> {
    const where: Prisma.WeightEntryWhereInput = { userId };

    if (cursor !== undefined) {
      where.OR = [
        { recordedAt: { lt: new Date(cursor.at) } },
        { recordedAt: new Date(cursor.at), id: { lt: cursor.id } },
      ];
    }

    return this.prisma.weightEntry.findMany({
      where,
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  /** Chronological, for trend lines. Bounded by the caller's window. */
  findWeightsBetween(userId: string, from: string, to: string): Promise<WeightEntry[]> {
    return this.prisma.weightEntry.findMany({
      where: { userId, localDate: { gte: from, lte: to } },
      orderBy: { localDate: 'asc' },
    });
  }

  findFirstWeight(userId: string): Promise<WeightEntry | null> {
    return this.prisma.weightEntry.findFirst({ where: { userId }, orderBy: { localDate: 'asc' } });
  }

  findLatestWeight(userId: string): Promise<WeightEntry | null> {
    return this.prisma.weightEntry.findFirst({ where: { userId }, orderBy: { localDate: 'desc' } });
  }

  deleteWeight(userId: string, id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.weightEntry.deleteMany({ where: { id, userId } });
  }

  /**
   * Local dates on which the user did something that counts as activity.
   *
   * Two sources today — a weigh-in or a completed workout — unioned in SQL so
   * the streak never loads a year of rows into memory to count distinct days.
   */
  async findActiveDates(userId: string, from: string, to: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ local_date: string }[]>`
      SELECT DISTINCT local_date FROM (
        SELECT local_date FROM weight_entries
          WHERE user_id = ${userId}::uuid AND local_date BETWEEN ${from} AND ${to}
        UNION
        SELECT local_date FROM workout_sessions
          WHERE user_id = ${userId}::uuid AND status = 'COMPLETED' AND deleted_at IS NULL
            AND local_date BETWEEN ${from} AND ${to}
      ) AS activity
      ORDER BY local_date DESC
    `;

    return rows.map((row) => row.local_date);
  }

  /** Distinct local days with a completed workout — drives the weekly strip. */
  async findCompletedWorkoutDates(userId: string, from: string, to: string): Promise<string[]> {
    const rows = await this.prisma.workoutSession.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        deletedAt: null,
        localDate: { gte: from, lte: to },
      },
      select: { localDate: true },
      distinct: ['localDate'],
    });

    return rows.map((row) => row.localDate);
  }

  /** Training totals for a window, aggregated in SQL rather than in JS. */
  async findTrainingTotals(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ sessions: number; totalSets: number; totalVolumeKg: number }> {
    const rows = await this.prisma.$queryRaw<
      { sessions: bigint; total_sets: bigint; total_volume: number | null }[]
    >`
      SELECT
        COUNT(DISTINCT s.id)                                          AS sessions,
        COUNT(l.id) FILTER (WHERE l.is_warmup = false)                AS total_sets,
        COALESCE(SUM(l.weight_kg * l.reps) FILTER (WHERE l.is_warmup = false), 0) AS total_volume
      FROM workout_sessions s
      LEFT JOIN set_logs l ON l.session_id = s.id
      WHERE s.user_id = ${userId}::uuid
        AND s.status = 'COMPLETED'
        AND s.deleted_at IS NULL
        AND s.local_date BETWEEN ${from} AND ${to}
    `;

    const row = rows[0];
    return {
      sessions: Number(row?.sessions ?? 0),
      totalSets: Number(row?.total_sets ?? 0),
      totalVolumeKg: Math.round((row?.total_volume ?? 0) * 10) / 10,
    };
  }

  findTrainingTargetPerWeek(userId: string): Promise<{ daysPerWeek: number } | null> {
    return this.prisma.workoutPreference.findUnique({
      where: { userId },
      select: { daysPerWeek: true },
    });
  }

  findWeightGoal(userId: string): Promise<{ targetWeightKg: number } | null> {
    return this.prisma.profile.findUnique({
      where: { userId },
      select: { targetWeightKg: true },
    });
  }
}
