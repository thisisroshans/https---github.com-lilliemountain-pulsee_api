import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../../src/modules/auth/auth.schema.js';
import { disconnectPrisma, getPrisma } from '../../src/shared/db/prisma.js';
import type { SuccessEnvelope } from '../../src/shared/http/envelope.js';
import { todayIn, addLocalDays } from '../../src/shared/utils/local-date.js';
import { buildTestApp, jsonBody } from '../helpers/build-test-app.js';
import { FakeIdentityVerifier, fakeIdToken } from '../helpers/fake-identity-verifier.js';
import { resetDatabase } from '../helpers/reset-db.js';

const PHONE = '+919876543210';
const OTHER_PHONE = '+919812345678';

interface WeightEntryResponse {
  id: string;
  weightKg: number;
  date: string;
  source: string;
}

interface StreakResponse {
  currentDays: number;
  longestDays: number;
  lastActiveDate: string | null;
  activeToday: boolean;
}

describe('progress routes', () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
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
    return `10.3.${String(Math.floor(clientCounter / 250))}.${String(clientCounter % 250)}`;
  };

  const call = (options: InjectOptions) => app.inject({ ...options, remoteAddress: nextIp() });

  async function signIn(phone: string): Promise<Session> {
    const response = await call({
      method: 'POST',
      url: '/api/v1/auth/firebase',
      payload: { idToken: fakeIdToken(phone) },
    });
    return jsonBody<SuccessEnvelope<Session>>(response.payload).data;
  }

  const authed = (options: InjectOptions, token = accessToken) =>
    call({ ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } });

  const dataOf = <T>(payload: string): T => jsonBody<SuccessEnvelope<T>>(payload).data;

  const recordWeight = (body: Record<string, unknown>, token?: string) =>
    authed({ method: 'POST', url: '/api/v1/progress/weight', payload: body }, token);

  beforeEach(async () => {
    await resetDatabase();
    const session = await signIn(PHONE);
    accessToken = session.accessToken;
    userId = session.user.id;
  });

  describe('authentication', () => {
    it.each([
      ['GET', '/api/v1/progress/summary'],
      ['POST', '/api/v1/progress/weight'],
      ['GET', '/api/v1/progress/streak'],
    ])('rejects %s %s without a token', async (method, url) => {
      expect((await call({ method: method as 'GET', url, payload: {} })).statusCode).toBe(401);
    });
  });

  describe('POST /progress/weight', () => {
    it('records a weigh-in in kg', async () => {
      const entry = dataOf<WeightEntryResponse>((await recordWeight({ weight: 78.4 })).payload);

      expect(entry.weightKg).toBe(78.4);
      expect(entry.source).toBe('manual');
      expect(entry.date).toBe(todayIn('Asia/Kolkata'));
    });

    it('converts pounds to kilograms', async () => {
      const entry = dataOf<WeightEntryResponse>((await recordWeight({ weight: 172, unit: 'lb' })).payload);

      expect(entry.weightKg).toBeCloseTo(78.02, 1);
    });

    it('corrects rather than duplicates a same-day entry', async () => {
      await recordWeight({ weight: 78 });
      const corrected = dataOf<WeightEntryResponse>((await recordWeight({ weight: 77.5 })).payload);

      // A trend built from several same-day readings measures hydration, not
      // progress — so the day holds exactly one number.
      expect(corrected.weightKg).toBe(77.5);
      expect(await getPrisma().weightEntry.count({ where: { userId } })).toBe(1);
    });

    it('accepts a backdated entry', async () => {
      const yesterday = addLocalDays(todayIn('Asia/Kolkata'), -1);

      const entry = dataOf<WeightEntryResponse>(
        (await recordWeight({ weight: 79, date: yesterday })).payload,
      );

      expect(entry.date).toBe(yesterday);
    });

    it.each([
      ['an implausible weight', { weight: 5 }],
      ['a negative weight', { weight: -70 }],
      ['a malformed date', { weight: 78, date: '02-08-2026' }],
      ['an unknown source', { weight: 78, source: 'telepathy' }],
    ])('rejects %s', async (_label, body) => {
      expect((await recordWeight(body)).statusCode).toBe(400);
    });
  });

  describe('GET /progress/weight', () => {
    it('lists newest first and paginates', async () => {
      const today = todayIn('Asia/Kolkata');
      for (let i = 0; i < 3; i += 1) {
        await recordWeight({ weight: 78 - i, date: addLocalDays(today, -i) });
      }

      const page = jsonBody<SuccessEnvelope<WeightEntryResponse[]>>(
        (await authed({ method: 'GET', url: '/api/v1/progress/weight?limit=2' })).payload,
      );

      expect(page.data).toHaveLength(2);
      expect(page.meta?.pagination?.hasMore).toBe(true);
    });

    it("excludes another user's entries", async () => {
      await recordWeight({ weight: 78 });
      const other = await signIn(OTHER_PHONE);

      const page = jsonBody<SuccessEnvelope<WeightEntryResponse[]>>(
        (await authed({ method: 'GET', url: '/api/v1/progress/weight' }, other.accessToken)).payload,
      );

      expect(page.data).toEqual([]);
    });
  });

  describe('DELETE /progress/weight/:id', () => {
    it('deletes the caller’s own entry', async () => {
      const entry = dataOf<WeightEntryResponse>((await recordWeight({ weight: 78 })).payload);

      const response = await authed({
        method: 'DELETE',
        url: `/api/v1/progress/weight/${entry.id}`,
      });

      expect(response.statusCode).toBe(204);
      expect(await getPrisma().weightEntry.count()).toBe(0);
    });

    it("404s on another user's entry and leaves it intact", async () => {
      const entry = dataOf<WeightEntryResponse>((await recordWeight({ weight: 78 })).payload);
      const other = await signIn(OTHER_PHONE);

      const response = await authed(
        { method: 'DELETE', url: `/api/v1/progress/weight/${entry.id}` },
        other.accessToken,
      );

      expect(response.statusCode).toBe(404);
      expect(await getPrisma().weightEntry.count()).toBe(1);
    });
  });

  describe('GET /progress/streak', () => {
    it('starts at zero', async () => {
      const streak = dataOf<StreakResponse>(
        (await authed({ method: 'GET', url: '/api/v1/progress/streak' })).payload,
      );

      expect(streak).toMatchObject({ currentDays: 0, longestDays: 0, activeToday: false });
    });

    it('counts a weigh-in as activity', async () => {
      await recordWeight({ weight: 78 });

      const streak = dataOf<StreakResponse>(
        (await authed({ method: 'GET', url: '/api/v1/progress/streak' })).payload,
      );

      expect(streak.currentDays).toBe(1);
      expect(streak.activeToday).toBe(true);
    });

    it('counts consecutive days', async () => {
      const today = todayIn('Asia/Kolkata');
      for (let i = 0; i < 3; i += 1) {
        await recordWeight({ weight: 78, date: addLocalDays(today, -i) });
      }

      const streak = dataOf<StreakResponse>(
        (await authed({ method: 'GET', url: '/api/v1/progress/streak' })).payload,
      );

      expect(streak.currentDays).toBe(3);
    });

    it('counts a completed workout as activity too', async () => {
      const { EXERCISE_CATALOG } = await import('../../prisma/seed-data/exercises.js');
      const { uuidv7 } = await import('uuidv7');
      await getPrisma().exercise.createMany({
        data: EXERCISE_CATALOG.map((e) => ({ id: uuidv7(), ...e })),
        skipDuplicates: true,
      });
      const exercise = await getPrisma().exercise.findFirstOrThrow();

      const session = dataOf<{ id: string }>(
        (await authed({ method: 'POST', url: '/api/v1/workout-sessions', payload: {} })).payload,
      );
      await authed({
        method: 'PUT',
        url: `/api/v1/workout-sessions/${session.id}/sets`,
        payload: { exerciseId: exercise.id, setNumber: 1, reps: 10, weightKg: 20 },
      });
      await authed({
        method: 'POST',
        url: `/api/v1/workout-sessions/${session.id}/complete`,
        payload: {},
      });

      const streak = dataOf<StreakResponse>(
        (await authed({ method: 'GET', url: '/api/v1/progress/streak' })).payload,
      );

      expect(streak.currentDays).toBe(1);
    });
  });

  describe('GET /progress/summary', () => {
    it('assembles weight, streak, adherence and training in one call', async () => {
      const today = todayIn('Asia/Kolkata');
      await recordWeight({ weight: 80, date: addLocalDays(today, -6) });
      await recordWeight({ weight: 78, date: today });

      const summary = dataOf<{
        period: string;
        weight: { currentKg: number; startingKg: number; changeKg: number };
        streak: StreakResponse;
        adherence: { week: unknown[]; targetPerWeek: number };
        training: { sessions: number };
      }>((await authed({ method: 'GET', url: '/api/v1/progress/summary' })).payload);

      expect(summary.period).toBe('week');
      expect(summary.weight.currentKg).toBe(78);
      expect(summary.weight.startingKg).toBe(80);
      expect(summary.weight.changeKg).toBe(-2);
      expect(summary.streak.currentDays).toBeGreaterThan(0);
      expect(summary.adherence.week).toHaveLength(7);
      expect(summary.training.sessions).toBe(0);
    });

    it('honours the period parameter', async () => {
      const summary = dataOf<{ period: string; from: string; to: string }>(
        (await authed({ method: 'GET', url: '/api/v1/progress/summary?period=month' })).payload,
      );

      expect(summary.period).toBe('month');
      expect(summary.from).toBe(addLocalDays(summary.to, -29));
    });

    it('rejects an unknown period', async () => {
      const response = await authed({
        method: 'GET',
        url: '/api/v1/progress/summary?period=decade',
      });

      expect(response.statusCode).toBe(400);
    });

    it('works for a brand-new user with no data', async () => {
      const summary = dataOf<{
        weight: { currentKg: null; trend: unknown[] };
        streak: StreakResponse;
      }>((await authed({ method: 'GET', url: '/api/v1/progress/summary' })).payload);

      expect(summary.weight.currentKg).toBeNull();
      expect(summary.weight.trend).toEqual([]);
      expect(summary.streak.currentDays).toBe(0);
    });
  });

  describe('GET /progress/adherence', () => {
    it('reports a seven-day week and the onboarding target', async () => {
      await getPrisma().workoutPreference.create({
        data: {
          userId,
          locations: ['GYM'],
          daysPerWeek: 5,
          sessionMinutes: 45,
          preferredTime: 'MORNING',
          experienceLevel: 'SOME',
        },
      });

      const adherence = dataOf<{ targetPerWeek: number; week: { trained: boolean }[] }>(
        (await authed({ method: 'GET', url: '/api/v1/progress/adherence' })).payload,
      );

      expect(adherence.targetPerWeek).toBe(5);
      expect(adherence.week).toHaveLength(7);
      expect(adherence.week.some((day) => day.trained)).toBe(false);
    });

    it('reports zero target when onboarding has not set one', async () => {
      const adherence = dataOf<{ targetPerWeek: number }>(
        (await authed({ method: 'GET', url: '/api/v1/progress/adherence' })).payload,
      );

      expect(adherence.targetPerWeek).toBe(0);
    });
  });
});
