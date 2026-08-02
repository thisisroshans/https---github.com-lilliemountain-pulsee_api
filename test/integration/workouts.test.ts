import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../../src/modules/auth/auth.schema.js';
import { disconnectPrisma, getPrisma } from '../../src/shared/db/prisma.js';
import type { ErrorEnvelope, SuccessEnvelope } from '../../src/shared/http/envelope.js';
import { buildTestApp, jsonBody } from '../helpers/build-test-app.js';
import { FakeIdentityVerifier, fakeIdToken } from '../helpers/fake-identity-verifier.js';
import { resetDatabase } from '../helpers/reset-db.js';

/**
 * Screen 9 end to end: catalog, training log, and progress.
 */

const PHONE = '+919876543210';
const OTHER_PHONE = '+919812345678';

interface SessionDetail {
  id: string;
  status: string;
  setCount: number;
  exerciseCount: number;
  totalVolumeKg: number;
  totalReps: number;
  completedAt: string | null;
  durationSeconds: number | null;
  sets: { id: string; exerciseId: string; setNumber: number; reps: number; weightKg: number | null }[];
}

interface ExerciseSummary {
  id: string;
  slug: string;
  name: string;
  category: string;
  isWeighted: boolean;
}

describe('workout routes', () => {
  let app: FastifyInstance;
  let accessToken: string;
  let benchPressId: string;
  let plankId: string;
  let clientCounter = 0;

  beforeAll(async () => {
    app = await buildTestApp({ identityVerifier: new FakeIdentityVerifier() });
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  const nextIp = () => {
    clientCounter += 1;
    return `10.2.${String(Math.floor(clientCounter / 250))}.${String(clientCounter % 250)}`;
  };

  const call = (options: InjectOptions) => app.inject({ ...options, remoteAddress: nextIp() });

  async function signIn(phone: string): Promise<string> {
    const response = await call({
      method: 'POST',
      url: '/api/v1/auth/firebase',
      payload: { idToken: fakeIdToken(phone) },
    });
    return jsonBody<SuccessEnvelope<Session>>(response.payload).data.accessToken;
  }

  const authed = (options: InjectOptions, token = accessToken) =>
    call({ ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } });

  const dataOf = <T>(payload: string): T => jsonBody<SuccessEnvelope<T>>(payload).data;

  const startSession = (token?: string) =>
    authed({ method: 'POST', url: '/api/v1/workout-sessions', payload: { title: 'Upper body' } }, token);

  const logSet = (sessionId: string, body: Record<string, unknown>, token?: string) =>
    authed({ method: 'PUT', url: `/api/v1/workout-sessions/${sessionId}/sets`, payload: body }, token);

  const completeSession = (sessionId: string, body: Record<string, unknown> = {}) =>
    authed({
      method: 'POST',
      url: `/api/v1/workout-sessions/${sessionId}/complete`,
      payload: body,
    });

  beforeEach(async () => {
    await resetDatabase();
    await seedExercises();
    accessToken = await signIn(PHONE);

    const exercises = dataOf<ExerciseSummary[]>(
      (await authed({ method: 'GET', url: '/api/v1/exercises' })).payload,
    );
    benchPressId = exerciseIdBySlug(exercises, 'dumbbell-bench-press');
    plankId = exerciseIdBySlug(exercises, 'plank');
  });

  describe('authentication', () => {
    it.each([
      ['GET', '/api/v1/exercises'],
      ['POST', '/api/v1/workout-sessions'],
      ['GET', '/api/v1/workout-sessions'],
    ])('rejects %s %s without a token', async (method, url) => {
      const response = await call({ method: method as 'GET', url, payload: {} });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /exercises', () => {
    it('returns the catalog in display order', async () => {
      const exercises = dataOf<ExerciseSummary[]>(
        (await authed({ method: 'GET', url: '/api/v1/exercises' })).payload,
      );

      expect(exercises.length).toBeGreaterThan(5);
      expect(exercises[0]?.slug).toBe('dumbbell-bench-press');
    });

    it('filters by category', async () => {
      const exercises = dataOf<ExerciseSummary[]>(
        (await authed({ method: 'GET', url: '/api/v1/exercises?category=cardio' })).payload,
      );

      expect(exercises.every((e) => e.category === 'cardio')).toBe(true);
      expect(exercises.length).toBeGreaterThan(0);
    });

    it('matches a muscle whether primary or secondary', async () => {
      const exercises = dataOf<ExerciseSummary[]>(
        (await authed({ method: 'GET', url: '/api/v1/exercises?muscle=triceps' })).payload,
      );

      // Bench press trains triceps secondarily; the extension primarily.
      const slugs = exercises.map((e) => e.slug);
      expect(slugs).toContain('dumbbell-bench-press');
      expect(slugs).toContain('tricep-extension');
    });

    it('searches by name, case-insensitively', async () => {
      const exercises = dataOf<ExerciseSummary[]>(
        (await authed({ method: 'GET', url: '/api/v1/exercises?q=SQUAT' })).payload,
      );

      expect(exercises).toHaveLength(1);
      expect(exercises[0]?.slug).toBe('goblet-squat');
    });

    it('rejects an unknown filter value', async () => {
      const response = await authed({ method: 'GET', url: '/api/v1/exercises?category=telepathy' });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /exercises/:id', () => {
    it('returns coaching cues and muscles', async () => {
      const detail = dataOf<{ howToSteps: string[]; primaryMuscles: string[]; lastPerformed: unknown }>(
        (await authed({ method: 'GET', url: `/api/v1/exercises/${benchPressId}` })).payload,
      );

      expect(detail.howToSteps.length).toBeGreaterThan(2);
      expect(detail.primaryMuscles).toContain('chest');
      expect(detail.lastPerformed).toBeNull();
    });

    it('pre-fills from the last working set once there is history', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 22.5 });
      await completeSession(session.id);

      const detail = dataOf<{
        lastPerformed: { weightKg: number; reps: number; estimatedOneRepMaxKg: number } | null;
      }>((await authed({ method: 'GET', url: `/api/v1/exercises/${benchPressId}` })).payload);

      expect(detail.lastPerformed?.weightKg).toBe(22.5);
      expect(detail.lastPerformed?.reps).toBe(10);
      expect(detail.lastPerformed?.estimatedOneRepMaxKg).toBeCloseTo(30, 0);
    });

    it('404s for an unknown exercise', async () => {
      const response = await authed({
        method: 'GET',
        url: '/api/v1/exercises/0192f000-0000-7000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('sessions', () => {
    it('starts a session with 201', async () => {
      const response = await startSession();

      expect(response.statusCode).toBe(201);
      expect(dataOf<SessionDetail>(response.payload).status).toBe('in_progress');
    });

    it('resumes rather than duplicating an open session', async () => {
      const first = dataOf<SessionDetail>((await startSession()).payload);
      const second = await startSession();

      // A double tap on "Start workout" must not split one workout in two.
      expect(second.statusCode).toBe(200);
      expect(dataOf<SessionDetail>(second.payload).id).toBe(first.id);
      expect(await getPrisma().workoutSession.count()).toBe(1);
    });

    it('exposes the open session for restoring an interrupted workout', async () => {
      const started = dataOf<SessionDetail>((await startSession()).payload);

      const active = dataOf<SessionDetail | null>(
        (await authed({ method: 'GET', url: '/api/v1/workout-sessions/active' })).payload,
      );

      expect(active?.id).toBe(started.id);
    });

    it('returns null when nothing is in progress', async () => {
      const active = dataOf<SessionDetail | null>(
        (await authed({ method: 'GET', url: '/api/v1/workout-sessions/active' })).payload,
      );

      expect(active).toBeNull();
    });
  });

  describe('logging sets', () => {
    it('accumulates volume and reps', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });
      const updated = dataOf<SessionDetail>(
        (await logSet(session.id, { exerciseId: benchPressId, setNumber: 2, reps: 8, weightKg: 22.5 }))
          .payload,
      );

      expect(updated.setCount).toBe(2);
      expect(updated.exerciseCount).toBe(1);
      expect(updated.totalVolumeKg).toBe(380); // 10*20 + 8*22.5
      expect(updated.totalReps).toBe(18);
    });

    it('replaces a set when the same number is re-sent', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 200 });
      const corrected = dataOf<SessionDetail>(
        (await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 }))
          .payload,
      );

      expect(corrected.sets).toHaveLength(1);
      expect(corrected.sets[0]?.weightKg).toBe(20);
    });

    it('excludes warm-ups from volume', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      await logSet(session.id, {
        exerciseId: benchPressId,
        setNumber: 1,
        reps: 12,
        weightKg: 10,
        isWarmup: true,
      });
      const updated = dataOf<SessionDetail>(
        (await logSet(session.id, { exerciseId: benchPressId, setNumber: 2, reps: 8, weightKg: 25 })).payload,
      );

      expect(updated.setCount).toBe(1);
      expect(updated.totalVolumeKg).toBe(200);
    });

    it('accepts a bodyweight hold logged by duration', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      const updated = dataOf<SessionDetail>(
        (
          await logSet(session.id, {
            exerciseId: plankId,
            setNumber: 1,
            reps: 0,
            durationSeconds: 60,
          })
        ).payload,
      );

      expect(updated.setCount).toBe(1);
      expect(updated.totalVolumeKg).toBe(0);
    });

    it('rejects a set with neither reps nor duration', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      const response = await logSet(session.id, { exerciseId: plankId, setNumber: 1, reps: 0 });

      expect(response.statusCode).toBe(400);
    });

    it('rejects load on an exercise that takes none', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      const response = await logSet(session.id, {
        exerciseId: plankId,
        setNumber: 1,
        reps: 0,
        durationSeconds: 60,
        weightKg: 40,
      });

      expect(response.statusCode).toBe(422);
      expect(jsonBody<ErrorEnvelope>(response.payload).error.details?.[0]?.path).toBe('weightKg');
    });

    it('removes a set', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      const withSet = dataOf<SessionDetail>(
        (await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 }))
          .payload,
      );
      const setId = withSet.sets[0]?.id ?? '';

      const after = dataOf<SessionDetail>(
        (
          await authed({
            method: 'DELETE',
            url: `/api/v1/workout-sessions/${session.id}/sets/${setId}`,
          })
        ).payload,
      );

      expect(after.sets).toHaveLength(0);
    });

    it('404s for an unknown exercise', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      const response = await logSet(session.id, {
        exerciseId: '0192f000-0000-7000-8000-000000000000',
        setNumber: 1,
        reps: 10,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('completing a session', () => {
    it('records completion and duration', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });

      const completed = dataOf<SessionDetail>(
        (await completeSession(session.id, { perceivedExertion: 7, notes: 'Felt strong' })).payload,
      );

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).not.toBeNull();
      expect(completed.durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('refuses to complete an empty session', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);

      const response = await completeSession(session.id);

      expect(response.statusCode).toBe(422);
    });

    it('is idempotent', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });

      const first = dataOf<SessionDetail>((await completeSession(session.id)).payload);
      const second = dataOf<SessionDetail>((await completeSession(session.id)).payload);

      expect(second.completedAt).toBe(first.completedAt);
    });

    it('refuses to change sets after completion', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });
      await completeSession(session.id);

      const response = await logSet(session.id, {
        exerciseId: benchPressId,
        setNumber: 2,
        reps: 8,
        weightKg: 22.5,
      });

      expect(response.statusCode).toBe(422);
    });

    it('frees the user to start a new session', async () => {
      const first = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(first.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });
      await completeSession(first.id);

      const second = await startSession();

      expect(second.statusCode).toBe(201);
      expect(dataOf<SessionDetail>(second.payload).id).not.toBe(first.id);
    });
  });

  describe('ownership', () => {
    it("404s rather than exposing another user's session", async () => {
      const mine = dataOf<SessionDetail>((await startSession()).payload);
      const otherToken = await signIn(OTHER_PHONE);

      const response = await authed(
        { method: 'GET', url: `/api/v1/workout-sessions/${mine.id}` },
        otherToken,
      );

      // 404, not 403: confirming the id exists would itself be a leak.
      expect(response.statusCode).toBe(404);
    });

    it("refuses to log a set into another user's session", async () => {
      const mine = dataOf<SessionDetail>((await startSession()).payload);
      const otherToken = await signIn(OTHER_PHONE);

      const response = await logSet(
        mine.id,
        { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 },
        otherToken,
      );

      expect(response.statusCode).toBe(404);
      expect(await getPrisma().setLog.count()).toBe(0);
    });

    it("excludes another user's sessions from history", async () => {
      const mine = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(mine.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });
      await completeSession(mine.id);

      const otherToken = await signIn(OTHER_PHONE);
      const theirs = jsonBody<SuccessEnvelope<SessionDetail[]>>(
        (await authed({ method: 'GET', url: '/api/v1/workout-sessions' }, otherToken)).payload,
      );

      expect(theirs.data).toEqual([]);
    });
  });

  describe('history and pagination', () => {
    it('paginates sessions newest first', async () => {
      for (let i = 0; i < 3; i += 1) {
        const session = dataOf<SessionDetail>((await startSession()).payload);
        await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 + i });
        await completeSession(session.id);
      }

      const firstPage = jsonBody<SuccessEnvelope<SessionDetail[]>>(
        (await authed({ method: 'GET', url: '/api/v1/workout-sessions?limit=2' })).payload,
      );

      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.meta?.pagination?.hasMore).toBe(true);

      const cursor = firstPage.meta?.pagination?.nextCursor ?? '';
      const secondPage = jsonBody<SuccessEnvelope<SessionDetail[]>>(
        (
          await authed({
            method: 'GET',
            url: `/api/v1/workout-sessions?limit=2&cursor=${encodeURIComponent(cursor)}`,
          })
        ).payload,
      );

      expect(secondPage.data).toHaveLength(1);
      expect(secondPage.meta?.pagination?.hasMore).toBe(false);
      // No overlap between pages.
      const ids = new Set([...firstPage.data, ...secondPage.data].map((s) => s.id));
      expect(ids.size).toBe(3);
    });

    it('rejects a malformed cursor', async () => {
      const response = await authed({
        method: 'GET',
        url: '/api/v1/workout-sessions?cursor=not-a-cursor',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns per-exercise history with a top set and 1RM', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 2, reps: 8, weightKg: 25 });
      await completeSession(session.id);

      const history = jsonBody<
        SuccessEnvelope<{ topSetWeightKg: number; estimatedOneRepMaxKg: number; sets: unknown[] }[]>
      >((await authed({ method: 'GET', url: `/api/v1/exercises/${benchPressId}/history` })).payload);

      expect(history.data).toHaveLength(1);
      expect(history.data[0]?.topSetWeightKg).toBe(25);
      expect(history.data[0]?.estimatedOneRepMaxKg).toBeCloseTo(31.7, 1);
    });

    it('excludes unfinished sessions from history', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });
      // Deliberately not completed.

      const history = jsonBody<SuccessEnvelope<unknown[]>>(
        (await authed({ method: 'GET', url: `/api/v1/exercises/${benchPressId}/history` })).payload,
      );

      expect(history.data).toEqual([]);
    });
  });

  describe('progress', () => {
    it('reports 1RM and weekly volume', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 22.5 });
      await completeSession(session.id);

      const progress = dataOf<{
        currentOneRepMaxKg: number | null;
        weeklyVolume: { volumeKg: number }[];
        totalSessions: number;
        isWeighted: boolean;
      }>((await authed({ method: 'GET', url: `/api/v1/exercises/${benchPressId}/progress` })).payload);

      expect(progress.currentOneRepMaxKg).toBeCloseTo(30, 0);
      expect(progress.weeklyVolume[0]?.volumeKg).toBe(225);
      expect(progress.totalSessions).toBe(1);
      expect(progress.isWeighted).toBe(true);
    });

    it('reports no 1RM for bodyweight work', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: plankId, setNumber: 1, reps: 0, durationSeconds: 60 });
      await completeSession(session.id);

      const progress = dataOf<{ currentOneRepMaxKg: number | null; isWeighted: boolean }>(
        (await authed({ method: 'GET', url: `/api/v1/exercises/${plankId}/progress` })).payload,
      );

      expect(progress.isWeighted).toBe(false);
      expect(progress.currentOneRepMaxKg).toBeNull();
    });

    it('is empty for an exercise never performed', async () => {
      const progress = dataOf<{ currentOneRepMaxKg: number | null; totalSessions: number }>(
        (await authed({ method: 'GET', url: `/api/v1/exercises/${benchPressId}/progress` })).payload,
      );

      expect(progress.currentOneRepMaxKg).toBeNull();
      expect(progress.totalSessions).toBe(0);
    });
  });

  describe('deleting', () => {
    it('soft-deletes a session and hides it from history', async () => {
      const session = dataOf<SessionDetail>((await startSession()).payload);
      await logSet(session.id, { exerciseId: benchPressId, setNumber: 1, reps: 10, weightKg: 20 });
      await completeSession(session.id);

      const response = await authed({
        method: 'DELETE',
        url: `/api/v1/workout-sessions/${session.id}`,
      });

      expect(response.statusCode).toBe(204);

      const remaining = jsonBody<SuccessEnvelope<unknown[]>>(
        (await authed({ method: 'GET', url: '/api/v1/workout-sessions' })).payload,
      );
      expect(remaining.data).toEqual([]);

      // Soft, not hard: support can still restore it.
      const row = await getPrisma().workoutSession.findUnique({ where: { id: session.id } });
      expect(row?.deletedAt).not.toBeNull();
    });
  });
});

async function seedExercises(): Promise<void> {
  const { EXERCISE_CATALOG } = await import('../../prisma/seed-data/exercises.js');
  const { uuidv7 } = await import('uuidv7');

  await getPrisma().exercise.createMany({
    data: EXERCISE_CATALOG.map((exercise) => ({ id: uuidv7(), ...exercise })),
    skipDuplicates: true,
  });
}

function exerciseIdBySlug(exercises: ExerciseSummary[], slug: string): string {
  const match = exercises.find((exercise) => exercise.slug === slug);
  if (!match) throw new Error(`seed missing exercise: ${slug}`);
  return match.id;
}
