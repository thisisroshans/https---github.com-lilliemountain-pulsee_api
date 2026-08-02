import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../../src/modules/auth/auth.schema.js';
import type { OnboardingState } from '../../src/modules/onboarding/onboarding.schema.js';
import { disconnectPrisma, getPrisma } from '../../src/shared/db/prisma.js';
import type { ErrorEnvelope, SuccessEnvelope } from '../../src/shared/http/envelope.js';
import { buildTestApp, jsonBody } from '../helpers/build-test-app.js';
import { FakeIdentityVerifier, fakeIdToken } from '../helpers/fake-identity-verifier.js';
import { resetDatabase } from '../helpers/reset-db.js';

/**
 * Screens 2-6 end to end against Postgres, as an authenticated user.
 */

const PHONE = '+919876543210';
const OTHER_PHONE = '+919812345678';

const VALID_PROFILE = {
  sex: 'male',
  ageYears: 29,
  heightUnit: 'cm',
  heightCm: 174,
  weightUnit: 'kg',
  weight: 78,
  targetWeight: 72,
  targetDeadline: 'three_months',
  activityLevel: 'moderate',
};

const VALID_DIET = {
  dietType: 'eggetarian',
  cuisines: ['North Indian', 'South Indian'],
  dislikes: ['paneer'],
  budgetTier: 'mid',
  cookedBy: 'household',
  cookingMinutes: 30,
  vegOnlyDays: ['tue'],
  supplements: [],
};

const VALID_WORKOUT = {
  locations: ['gym'],
  daysPerWeek: 5,
  sessionMinutes: 45,
  preferredTime: 'morning',
  experienceLevel: 'some',
  injuries: null,
};

describe('onboarding routes', () => {
  let app: FastifyInstance;
  let accessToken: string;
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
    return `10.1.${String(Math.floor(clientCounter / 250))}.${String(clientCounter % 250)}`;
  };

  const call = (options: InjectOptions) => app.inject({ ...options, remoteAddress: nextIp() });

  /** Signs a phone in and returns its access token. */
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

  const stateFrom = (payload: string) => jsonBody<SuccessEnvelope<OnboardingState>>(payload).data;

  const putGoals = (goals: string[], token?: string) =>
    authed({ method: 'PUT', url: '/api/v1/onboarding/goals', payload: { goals } }, token);

  const putProfile = (payload: Record<string, unknown> = VALID_PROFILE, token?: string) =>
    authed({ method: 'PUT', url: '/api/v1/onboarding/profile', payload }, token);

  const putDiet = (payload: Record<string, unknown> = VALID_DIET) =>
    authed({ method: 'PUT', url: '/api/v1/onboarding/diet', payload });

  const putWorkout = (payload: Record<string, unknown> = VALID_WORKOUT) =>
    authed({ method: 'PUT', url: '/api/v1/onboarding/workout', payload });

  beforeEach(async () => {
    await resetDatabase();
    await seedSupplements();
    accessToken = await signIn(PHONE);
  });

  describe('authentication', () => {
    it.each([
      ['GET', '/api/v1/onboarding'],
      ['PUT', '/api/v1/onboarding/goals'],
      ['PUT', '/api/v1/onboarding/profile'],
      ['POST', '/api/v1/onboarding/complete'],
      ['GET', '/api/v1/supplements'],
    ])('rejects %s %s without a token', async (method, url) => {
      const response = await call({ method: method as 'GET', url, payload: {} });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /onboarding', () => {
    it('starts empty with nothing complete', async () => {
      const state = stateFrom((await authed({ method: 'GET', url: '/api/v1/onboarding' })).payload);

      expect(state.goals).toEqual([]);
      expect(state.profile).toBeNull();
      expect(state.targets).toBeNull();
      expect(state.progress).toMatchObject({
        goals: false,
        profile: false,
        canComplete: false,
        completedAt: null,
      });
    });

    it("never leaks another user's onboarding", async () => {
      await putGoals(['lose_weight']);
      const otherToken = await signIn(OTHER_PHONE);

      const state = stateFrom(
        (await authed({ method: 'GET', url: '/api/v1/onboarding' }, otherToken)).payload,
      );

      expect(state.goals).toEqual([]);
    });
  });

  describe('PUT /onboarding/goals', () => {
    it('saves goals and reports progress', async () => {
      const state = stateFrom((await putGoals(['lose_weight', 'stamina_energy'])).payload);

      expect(state.goals).toEqual(['lose_weight', 'stamina_energy']);
      expect(state.progress.goals).toBe(true);
    });

    it('replaces rather than merges', async () => {
      await putGoals(['lose_weight', 'stamina_energy']);
      const state = stateFrom((await putGoals(['build_muscle'])).payload);

      expect(state.goals).toEqual(['build_muscle']);
      expect(await getPrisma().userGoal.count()).toBe(1);
    });

    it('rejects an empty goal list', async () => {
      const response = await putGoals([]);

      expect(response.statusCode).toBe(400);
      expect(jsonBody<ErrorEnvelope>(response.payload).error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unknown goal', async () => {
      const response = await putGoals(['become_a_wizard']);

      expect(response.statusCode).toBe(400);
    });

    it('rejects duplicates', async () => {
      const response = await putGoals(['lose_weight', 'lose_weight']);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /onboarding/profile', () => {
    beforeEach(async () => {
      await putGoals(['lose_weight']);
    });

    it('saves metric input and computes targets', async () => {
      const state = stateFrom((await putProfile()).payload);

      expect(state.profile).toMatchObject({ heightCm: 174, weightKg: 78, targetWeightKg: 72 });
      expect(state.targets?.kcal).toBeGreaterThan(1200);
      expect(state.targets?.dailyDeficitKcal).toBeGreaterThan(0);
    });

    it('converts imperial input to canonical units', async () => {
      const state = stateFrom(
        (
          await putProfile({
            ...VALID_PROFILE,
            heightUnit: 'ft_in',
            heightCm: undefined,
            heightFeet: 5,
            heightInches: 9,
            weightUnit: 'lb',
            weight: 172,
            targetWeight: 159,
          })
        ).payload,
      );

      expect(state.profile?.heightCm).toBeCloseTo(175.26, 1);
      expect(state.profile?.weightKg).toBeCloseTo(78.02, 1);
      // Echoed back in the units the user chose.
      expect(state.profile?.heightFeet).toBe(5);
      expect(state.profile?.heightInches).toBe(9);
    });

    it('requires a height in the declared unit', async () => {
      const response = await putProfile({ ...VALID_PROFILE, heightCm: undefined });

      expect(response.statusCode).toBe(400);
      expect(jsonBody<ErrorEnvelope>(response.payload).error.details?.[0]?.path).toBe('heightCm');
    });

    it('rejects a target weight that contradicts a weight-loss goal', async () => {
      const response = await putProfile({ ...VALID_PROFILE, targetWeight: 90 });

      expect(response.statusCode).toBe(422);
      const body = jsonBody<ErrorEnvelope>(response.payload);
      expect(body.error.code).toBe('UNPROCESSABLE');
      expect(body.error.details?.[0]?.path).toBe('targetWeight');
    });

    it('rejects a target weight that contradicts a muscle-gain goal', async () => {
      await putGoals(['build_muscle']);
      const response = await putProfile({ ...VALID_PROFILE, targetWeight: 65 });

      expect(response.statusCode).toBe(422);
    });

    it.each([
      ['an implausible age', { ageYears: 5 }],
      ['an implausible height', { heightCm: 20 }],
      ['a negative weight', { weight: -5 }],
      ['an unknown activity level', { activityLevel: 'olympian' }],
    ])('rejects %s', async (_label, patch) => {
      const response = await putProfile({ ...VALID_PROFILE, ...patch });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /onboarding/health', () => {
    it('saves conditions and allergies', async () => {
      const state = stateFrom(
        (
          await authed({
            method: 'PUT',
            url: '/api/v1/onboarding/health',
            payload: {
              conditions: ['pcos', 'thyroid'],
              allergies: ['lactose'],
              medications: 'Thyronorm 50mcg',
              tracksCycle: true,
              pregnantOrNursing: false,
            },
          })
        ).payload,
      );

      expect(state.health).toMatchObject({
        conditions: ['pcos', 'thyroid'],
        allergies: ['lactose'],
        tracksCycle: true,
      });
    });

    it('accepts an empty submission as "none of these"', async () => {
      const state = stateFrom(
        (await authed({ method: 'PUT', url: '/api/v1/onboarding/health', payload: {} })).payload,
      );

      expect(state.health).toMatchObject({ conditions: [], allergies: [], medications: null });
      expect(state.progress.health).toBe(true);
    });
  });

  describe('PUT /onboarding/diet', () => {
    it('saves preferences and normalises tags', async () => {
      const state = stateFrom(
        (await putDiet({ ...VALID_DIET, cuisines: ['  Punjabi ', 'punjabi', 'Bengali', ''] })).payload,
      );

      // Trimmed, de-duplicated case-insensitively, blanks dropped.
      expect(state.diet?.cuisines).toEqual(['Punjabi', 'Bengali']);
    });

    it('saves a supplement stack and totals its protein', async () => {
      const whey = await supplementBySlug('whey-protein');
      const creatine = await supplementBySlug('creatine');

      const state = stateFrom(
        (
          await putDiet({
            ...VALID_DIET,
            supplements: [
              { supplementId: whey.id, proteinPerServingG: 24, servingsPerDay: 2 },
              { supplementId: creatine.id, proteinPerServingG: 0, servingsPerDay: 1 },
            ],
          })
        ).payload,
      );

      expect(state.diet?.supplementProteinG).toBe(48);
      expect(state.diet?.supplements).toHaveLength(2);
      expect(state.diet?.supplements[0]).toMatchObject({ slug: 'whey-protein', name: 'Whey protein' });
    });

    it('subtracts supplement protein from the food target', async () => {
      await putGoals(['lose_weight']);
      await putProfile();
      const whey = await supplementBySlug('whey-protein');

      const state = stateFrom(
        (
          await putDiet({
            ...VALID_DIET,
            supplements: [{ supplementId: whey.id, proteinPerServingG: 25, servingsPerDay: 2 }],
          })
        ).payload,
      );

      expect(state.targets?.proteinFromFoodG).toBe((state.targets?.proteinG ?? 0) - 50);
    });

    it('rejects a supplement that is not in the catalog', async () => {
      const response = await putDiet({
        ...VALID_DIET,
        supplements: [
          {
            supplementId: '0192f000-0000-7000-8000-000000000000',
            proteinPerServingG: 24,
            servingsPerDay: 1,
          },
        ],
      });

      expect(response.statusCode).toBe(400);
      expect(jsonBody<ErrorEnvelope>(response.payload).error.details?.[0]?.path).toBe('supplements');
    });

    it('ignores veg-only days for a diet that already excludes meat', async () => {
      const state = stateFrom(
        (await putDiet({ ...VALID_DIET, dietType: 'vegan', vegOnlyDays: ['mon', 'tue'] })).payload,
      );

      expect(state.diet?.vegOnlyDays).toEqual([]);
    });

    it('keeps veg-only days for a non-vegetarian', async () => {
      const state = stateFrom(
        (await putDiet({ ...VALID_DIET, dietType: 'non_vegetarian', vegOnlyDays: ['tue', 'thu'] })).payload,
      );

      expect(state.diet?.vegOnlyDays).toEqual(['tue', 'thu']);
    });

    it('replaces the stack rather than appending', async () => {
      const whey = await supplementBySlug('whey-protein');
      const creatine = await supplementBySlug('creatine');

      await putDiet({
        ...VALID_DIET,
        supplements: [{ supplementId: whey.id, proteinPerServingG: 24, servingsPerDay: 1 }],
      });
      const state = stateFrom(
        (
          await putDiet({
            ...VALID_DIET,
            supplements: [{ supplementId: creatine.id, proteinPerServingG: 0, servingsPerDay: 1 }],
          })
        ).payload,
      );

      expect(state.diet?.supplements).toHaveLength(1);
      expect(state.diet?.supplements[0]?.slug).toBe('creatine');
    });
  });

  describe('PUT /onboarding/workout', () => {
    it('saves training preferences', async () => {
      const state = stateFrom((await putWorkout()).payload);

      expect(state.workout).toMatchObject({ locations: ['gym'], daysPerWeek: 5 });
      expect(state.progress.workout).toBe(true);
    });

    it('requires at least one location', async () => {
      const response = await putWorkout({ ...VALID_WORKOUT, locations: [] });

      expect(response.statusCode).toBe(400);
    });

    it('de-duplicates locations', async () => {
      const state = stateFrom((await putWorkout({ ...VALID_WORKOUT, locations: ['gym', 'gym'] })).payload);

      expect(state.workout?.locations).toEqual(['gym']);
    });
  });

  describe('POST /onboarding/complete', () => {
    const complete = () => authed({ method: 'POST', url: '/api/v1/onboarding/complete', payload: {} });

    it('refuses while required steps are missing, and names them', async () => {
      await putGoals(['lose_weight']);

      const response = await complete();

      expect(response.statusCode).toBe(422);
      const body = jsonBody<ErrorEnvelope>(response.payload);
      expect(body.error.code).toBe('UNPROCESSABLE');
      expect(body.error.details?.map((d) => d.path)).toEqual(['profile', 'diet', 'workout']);
    });

    it('completes without the skippable health step', async () => {
      await putGoals(['lose_weight']);
      await putProfile();
      await putDiet();
      await putWorkout();

      const response = await complete();

      expect(response.statusCode).toBe(200);
      const state = stateFrom(response.payload);
      expect(state.progress.completedAt).not.toBeNull();
      expect(state.progress.health).toBe(false);
    });

    it('is idempotent and keeps the original timestamp', async () => {
      await putGoals(['lose_weight']);
      await putProfile();
      await putDiet();
      await putWorkout();

      const first = stateFrom((await complete()).payload);
      const second = stateFrom((await complete()).payload);

      expect(second.progress.completedAt).toBe(first.progress.completedAt);
    });

    it('writes one audit row for completion', async () => {
      await putGoals(['lose_weight']);
      await putProfile();
      await putDiet();
      await putWorkout();
      await complete();
      await complete();

      const audits = await getPrisma().auditLog.findMany({
        where: { action: 'ONBOARDING_COMPLETED' },
      });
      expect(audits).toHaveLength(1);
    });
  });

  describe('GET /supplements', () => {
    it('returns the active catalog in display order', async () => {
      const response = await authed({ method: 'GET', url: '/api/v1/supplements' });

      expect(response.statusCode).toBe(200);
      const items = jsonBody<SuccessEnvelope<{ slug: string; kind: string }[]>>(response.payload).data;
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.slug).toBe('whey-protein');
      expect(items.every((i) => i.kind === 'protein' || i.kind === 'other')).toBe(true);
    });
  });

  describe('full journey', () => {
    it('walks screens 2-6 and ends ready for plan generation', async () => {
      const whey = await supplementBySlug('whey-protein');

      await putGoals(['lose_weight', 'get_toned']);
      await putProfile();
      await authed({
        method: 'PUT',
        url: '/api/v1/onboarding/health',
        payload: { conditions: ['thyroid'], allergies: [], medications: null },
      });
      await putDiet({
        ...VALID_DIET,
        supplements: [{ supplementId: whey.id, proteinPerServingG: 24, servingsPerDay: 1 }],
      });
      await putWorkout();

      const state = stateFrom(
        (await authed({ method: 'POST', url: '/api/v1/onboarding/complete', payload: {} })).payload,
      );

      expect(state.progress).toMatchObject({
        goals: true,
        profile: true,
        health: true,
        diet: true,
        workout: true,
        canComplete: true,
      });
      expect(state.progress.completedAt).not.toBeNull();
      expect(state.targets?.kcal).toBeGreaterThan(1200);
      expect(state.targets?.proteinFromFoodG).toBe((state.targets?.proteinG ?? 0) - 24);
    });
  });
});

/** The catalog is reference data, so tests re-seed it after each truncation. */
async function seedSupplements(): Promise<void> {
  const { SUPPLEMENT_CATALOG } = await import('../../prisma/seed-data/supplements.js');
  const { uuidv7 } = await import('uuidv7');

  await getPrisma().supplement.createMany({
    data: SUPPLEMENT_CATALOG.map((s) => ({ id: uuidv7(), ...s })),
    skipDuplicates: true,
  });
}

async function supplementBySlug(slug: string): Promise<{ id: string }> {
  const supplement = await getPrisma().supplement.findUniqueOrThrow({ where: { slug } });
  return { id: supplement.id };
}
