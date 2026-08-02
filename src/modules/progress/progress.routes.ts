import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getPrisma } from '../../shared/db/prisma.js';
import { commonErrorResponses, ok, paginated, successSchema } from '../../shared/http/envelope.js';
import { currentUser, requireAuth } from '../../shared/middleware/auth.js';
import { uuidSchema } from '../../shared/validation/common.js';
import { UsersRepository } from '../users/users.repository.js';
import { ProgressRepository } from './progress.repository.js';
import {
  adherenceSchema,
  listWeightQuerySchema,
  progressSummarySchema,
  recordWeightSchema,
  streakSchema,
  summaryQuerySchema,
  weightEntrySchema,
  type ListWeightQuery,
  type RecordWeightInput,
  type SummaryQuery,
} from './progress.schema.js';
import { ProgressService, startOfWeek, type UserContext } from './progress.service.js';
import { todayIn } from '../../shared/utils/local-date.js';

/**
 * Screen 12. Small enough that the controller lives here rather than in its own
 * file — every handler is read input, call one service method, send.
 */
export async function progressRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();
  const service = new ProgressService(new ProgressRepository(prisma));
  const users = new UsersRepository(prisma);

  app.addHook('onRequest', requireAuth);

  const contextOf = async (request: FastifyRequest): Promise<UserContext> => {
    const userId = currentUser(request).id;
    return { userId, timezone: await users.findTimezone(userId) };
  };

  app.get(
    '/progress/summary',
    {
      schema: {
        tags: ['progress'],
        summary: 'Progress summary',
        description:
          'Weight trend, streak, training adherence and volume for the period. Everything ' +
          'screen 12 needs in one call.',
        security: [{ bearerAuth: [] }],
        querystring: summaryQuerySchema,
        response: { 200: successSchema(progressSummarySchema), ...commonErrorResponses },
      },
    },
    async (request: FastifyRequest<{ Querystring: SummaryQuery }>, reply: FastifyReply) => {
      const context = await contextOf(request);
      await reply.status(200).send(ok(await service.getSummary(context, request.query)));
    },
  );

  app.post(
    '/progress/weight',
    {
      schema: {
        tags: ['progress'],
        summary: 'Record a weigh-in',
        description:
          'One entry per day: submitting again for the same date corrects it rather than ' +
          'adding a second reading. Accepts kg or lb; stored in kg.',
        security: [{ bearerAuth: [] }],
        body: recordWeightSchema,
        response: { 200: successSchema(weightEntrySchema), ...commonErrorResponses },
      },
    },
    async (request: FastifyRequest<{ Body: RecordWeightInput }>, reply: FastifyReply) => {
      const context = await contextOf(request);
      await reply.status(200).send(ok(await service.recordWeight(context, request.body)));
    },
  );

  app.get(
    '/progress/weight',
    {
      schema: {
        tags: ['progress'],
        summary: 'Weight history',
        security: [{ bearerAuth: [] }],
        querystring: listWeightQuerySchema,
        response: { 200: successSchema(z.array(weightEntrySchema)), ...commonErrorResponses },
      },
    },
    async (request: FastifyRequest<{ Querystring: ListWeightQuery }>, reply: FastifyReply) => {
      const context = await contextOf(request);
      const page = await service.listWeights(context, request.query);
      await reply.status(200).send(paginated(page.items, page.pagination));
    },
  );

  app.delete(
    '/progress/weight/:entryId',
    {
      schema: {
        tags: ['progress'],
        summary: 'Delete a weigh-in',
        security: [{ bearerAuth: [] }],
        params: z.object({ entryId: uuidSchema }),
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    async (request: FastifyRequest<{ Params: { entryId: string } }>, reply: FastifyReply) => {
      const context = await contextOf(request);
      await service.deleteWeight(context, request.params.entryId);
      await reply.status(204).send();
    },
  );

  app.get(
    '/progress/streak',
    {
      schema: {
        tags: ['progress'],
        summary: 'Logging streak',
        description:
          'A day counts if the user weighed in or completed a workout. Yesterday still counts ' +
          'as current, so an unlogged today does not appear to break the streak.',
        security: [{ bearerAuth: [] }],
        response: { 200: successSchema(streakSchema), ...commonErrorResponses },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const context = await contextOf(request);
      await reply.status(200).send(ok(await service.getStreak(context)));
    },
  );

  app.get(
    '/progress/adherence',
    {
      schema: {
        tags: ['progress'],
        summary: 'Training adherence',
        description: 'Workouts completed this week against the target set during onboarding.',
        security: [{ bearerAuth: [] }],
        response: { 200: successSchema(adherenceSchema), ...commonErrorResponses },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const context = await contextOf(request);
      // The standalone endpoint reports the current week, matching the strip.
      const today = todayIn(context.timezone);
      const adherence = await service.getAdherence(context, startOfWeek(today), today);
      await reply.status(200).send(ok(adherence));
    },
  );
}
