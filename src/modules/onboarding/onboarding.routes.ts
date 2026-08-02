import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getPrisma } from '../../shared/db/prisma.js';
import { commonErrorResponses, successSchema } from '../../shared/http/envelope.js';
import { requireAuth } from '../../shared/middleware/auth.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingRepository } from './onboarding.repository.js';
import {
  onboardingStateSchema,
  putDietSchema,
  putGoalsSchema,
  putHealthSchema,
  putProfileSchema,
  putWorkoutSchema,
  supplementCatalogItemSchema,
} from './onboarding.schema.js';
import { OnboardingService } from './onboarding.service.js';

/**
 * Screens 2-6. Each section is a PUT that fully replaces its slice of state and
 * returns the complete onboarding state, including recomputed targets.
 */
export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  const controller = new OnboardingController(new OnboardingService(new OnboardingRepository(getPrisma())));

  const stateResponse = {
    200: successSchema(onboardingStateSchema),
    ...commonErrorResponses,
  };

  // Every onboarding route is scoped to the caller; there is no path parameter
  // to tamper with, because the user id always comes from the access token.
  //
  // onRequest, not preHandler: Fastify validates the body before preHandler
  // runs, so an anonymous caller would get a 400 describing the schema instead
  // of a 401. Authenticate first, then parse.
  app.addHook('onRequest', requireAuth);

  app.get(
    '/onboarding',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Current onboarding state',
        description:
          'Everything captured so far, which screens are done, and the live calorie and macro ' +
          'targets. Use `progress` to resume where the user left off.',
        security: [{ bearerAuth: [] }],
        response: stateResponse,
      },
    },
    controller.getState,
  );

  app.put(
    '/onboarding/goals',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Set goals (screen 2)',
        description: 'Replaces the goal set. At least one goal is required.',
        security: [{ bearerAuth: [] }],
        body: putGoalsSchema,
        response: stateResponse,
      },
    },
    controller.putGoals,
  );

  app.put(
    '/onboarding/profile',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Set body basics (screen 3)',
        description:
          "Accepts height and weight in the user's own units and stores them canonically " +
          '(cm/kg). Rejects a target weight that contradicts the chosen goals.',
        security: [{ bearerAuth: [] }],
        body: putProfileSchema,
        response: stateResponse,
      },
    },
    controller.putProfile,
  );

  app.put(
    '/onboarding/health',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Set health and lifestyle (screen 4)',
        description:
          'Optional step — the screen has a Skip button, and completion does not require it. ' +
          'Send empty arrays to record "none of these".',
        security: [{ bearerAuth: [] }],
        body: putHealthSchema,
        response: stateResponse,
      },
    },
    controller.putHealth,
  );

  app.put(
    '/onboarding/diet',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Set food preferences and supplement stack (screen 5)',
        description:
          'Diet preferences and supplements are saved together. `vegOnlyDays` is ignored for ' +
          'diets that already exclude meat and eggs.',
        security: [{ bearerAuth: [] }],
        body: putDietSchema,
        response: stateResponse,
      },
    },
    controller.putDiet,
  );

  app.put(
    '/onboarding/workout',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Set training preferences (screen 6)',
        security: [{ bearerAuth: [] }],
        body: putWorkoutSchema,
        response: stateResponse,
      },
    },
    controller.putWorkout,
  );

  app.post(
    '/onboarding/complete',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Finish onboarding',
        description:
          'Marks onboarding complete once goals, profile, diet and workout are set (health is ' +
          'optional). Idempotent: re-completing keeps the original timestamp. Returns 422 ' +
          'listing anything still missing.',
        security: [{ bearerAuth: [] }],
        body: z.object({}).optional(),
        response: stateResponse,
      },
    },
    controller.complete,
  );

  app.get(
    '/supplements',
    {
      schema: {
        tags: ['onboarding'],
        summary: 'Supplement catalog',
        description: 'Reference data for screen 5. Cached; changes rarely.',
        security: [{ bearerAuth: [] }],
        response: {
          200: successSchema(z.array(supplementCatalogItemSchema)),
          ...commonErrorResponses,
        },
      },
    },
    controller.getSupplementCatalog,
  );
}
