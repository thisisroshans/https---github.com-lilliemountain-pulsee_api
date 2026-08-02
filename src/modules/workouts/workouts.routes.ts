import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getPrisma } from '../../shared/db/prisma.js';
import { commonErrorResponses, successSchema } from '../../shared/http/envelope.js';
import { requireAuth } from '../../shared/middleware/auth.js';
import { uuidSchema } from '../../shared/validation/common.js';
import { UsersRepository } from '../users/users.repository.js';
import { WorkoutsController } from './workouts.controller.js';
import { WorkoutsRepository } from './workouts.repository.js';
import {
  completeSessionSchema,
  exerciseDetailSchema,
  exerciseHistoryPageSchema,
  exerciseProgressSchema,
  exerciseSummarySchema,
  listExercisesQuerySchema,
  listSessionsQuerySchema,
  logSetSchema,
  sessionDetailSchema,
  sessionPageSchema,
  startSessionSchema,
} from './workouts.schema.js';
import { WorkoutsService } from './workouts.service.js';

/**
 * Screen 9: the exercise catalog, the training log, and per-exercise progress.
 */
export async function workoutRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();
  const controller = new WorkoutsController(
    new WorkoutsService(new WorkoutsRepository(prisma)),
    new UsersRepository(prisma),
  );

  // Authenticate before validation; see the note in onboarding.routes.ts.
  app.addHook('onRequest', requireAuth);

  const sessionParams = z.object({ sessionId: uuidSchema });
  const exerciseParams = z.object({ exerciseId: uuidSchema });
  const sessionResponse = { 200: successSchema(sessionDetailSchema), ...commonErrorResponses };

  // --- Catalog --------------------------------------------------------------

  app.get(
    '/exercises',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Exercise catalog',
        description:
          'Filter by category, muscle (primary or secondary), or equipment, and search by name. ' +
          'Reference data shared by every user.',
        security: [{ bearerAuth: [] }],
        querystring: listExercisesQuerySchema,
        response: {
          200: successSchema(z.array(exerciseSummarySchema)),
          ...commonErrorResponses,
        },
      },
    },
    controller.listExercises,
  );

  app.get(
    '/exercises/:exerciseId',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Exercise detail',
        description:
          'Full detail including coaching cues, target muscles for the anatomy figure, and the ' +
          "caller's last working set for pre-filling the log.",
        security: [{ bearerAuth: [] }],
        params: exerciseParams,
        response: { 200: successSchema(exerciseDetailSchema), ...commonErrorResponses },
      },
    },
    controller.getExercise,
  );

  app.get(
    '/exercises/:exerciseId/history',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Per-exercise history',
        description: 'Completed sessions containing this exercise, newest first.',
        security: [{ bearerAuth: [] }],
        params: exerciseParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(10),
          cursor: z.string().min(1).optional(),
        }),
        response: { 200: successSchema(exerciseHistoryPageSchema.shape.items), ...commonErrorResponses },
      },
    },
    controller.getExerciseHistory,
  );

  app.get(
    '/exercises/:exerciseId/progress',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Strength progress',
        description:
          'Estimated 1RM trend (Epley) and weekly volume for the last 12 weeks. 1RM is null for ' +
          'bodyweight and cardio work, where load is not meaningful.',
        security: [{ bearerAuth: [] }],
        params: exerciseParams,
        response: { 200: successSchema(exerciseProgressSchema), ...commonErrorResponses },
      },
    },
    controller.getExerciseProgress,
  );

  // --- Sessions -------------------------------------------------------------

  app.post(
    '/workout-sessions',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Start a workout',
        description:
          'Returns 201 for a new session, or 200 with the session already in progress. ' +
          'Idempotent, so a double tap cannot split one workout across two sessions.',
        security: [{ bearerAuth: [] }],
        body: startSessionSchema,
        response: {
          200: successSchema(sessionDetailSchema),
          201: successSchema(sessionDetailSchema),
          ...commonErrorResponses,
        },
      },
    },
    controller.startSession,
  );

  app.get(
    '/workout-sessions/active',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Session in progress',
        description: 'The open session, or null. Lets the app restore an interrupted workout.',
        security: [{ bearerAuth: [] }],
        response: {
          200: successSchema(sessionDetailSchema.nullable()),
          ...commonErrorResponses,
        },
      },
    },
    controller.getActiveSession,
  );

  app.get(
    '/workout-sessions',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Training history',
        security: [{ bearerAuth: [] }],
        querystring: listSessionsQuerySchema,
        response: { 200: successSchema(sessionPageSchema.shape.items), ...commonErrorResponses },
      },
    },
    controller.listSessions,
  );

  app.get(
    '/workout-sessions/:sessionId',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Session detail',
        security: [{ bearerAuth: [] }],
        params: sessionParams,
        response: sessionResponse,
      },
    },
    controller.getSession,
  );

  app.put(
    '/workout-sessions/:sessionId/sets',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Log a set',
        description:
          'Re-sending the same set number replaces it, so correcting a mistyped weight is safe ' +
          'to retry. Returns the updated session.',
        security: [{ bearerAuth: [] }],
        params: sessionParams,
        body: logSetSchema,
        response: sessionResponse,
      },
    },
    controller.logSet,
  );

  app.delete(
    '/workout-sessions/:sessionId/sets/:setId',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Remove a set',
        security: [{ bearerAuth: [] }],
        params: sessionParams.extend({ setId: uuidSchema }),
        response: sessionResponse,
      },
    },
    controller.deleteSet,
  );

  app.post(
    '/workout-sessions/:sessionId/complete',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Finish a workout',
        description: 'Idempotent — re-completing returns the session unchanged.',
        security: [{ bearerAuth: [] }],
        params: sessionParams,
        body: completeSessionSchema,
        response: sessionResponse,
      },
    },
    controller.completeSession,
  );

  app.post(
    '/workout-sessions/:sessionId/abandon',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Abandon a workout',
        description: 'Ends an unfinished session without counting it towards adherence.',
        security: [{ bearerAuth: [] }],
        params: sessionParams,
        response: sessionResponse,
      },
    },
    controller.abandonSession,
  );

  app.delete(
    '/workout-sessions/:sessionId',
    {
      schema: {
        tags: ['workouts'],
        summary: 'Delete a session',
        description: 'Soft delete; recoverable by support.',
        security: [{ bearerAuth: [] }],
        params: sessionParams,
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    controller.deleteSession,
  );
}
