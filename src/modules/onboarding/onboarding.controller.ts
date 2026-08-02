import type { FastifyReply, FastifyRequest } from 'fastify';

import { ok } from '../../shared/http/envelope.js';
import { currentUser } from '../../shared/middleware/auth.js';
import type {
  PutDietInput,
  PutGoalsInput,
  PutHealthInput,
  PutProfileInput,
  PutWorkoutInput,
} from './onboarding.schema.js';
import type { OnboardingService } from './onboarding.service.js';

/**
 * Every section write returns the whole onboarding state, not just the section
 * that changed: saving body stats changes the calorie target, and saving a
 * supplement stack changes how much protein must come from food. One response
 * keeps the app consistent without a follow-up GET.
 */
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  getState = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await reply.status(200).send(ok(await this.service.getState(currentUser(request).id)));
  };

  putGoals = async (request: FastifyRequest<{ Body: PutGoalsInput }>, reply: FastifyReply): Promise<void> => {
    const state = await this.service.putGoals(currentUser(request).id, request.body);
    await reply.status(200).send(ok(state));
  };

  putProfile = async (
    request: FastifyRequest<{ Body: PutProfileInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const state = await this.service.putProfile(currentUser(request).id, request.body);
    await reply.status(200).send(ok(state));
  };

  putHealth = async (
    request: FastifyRequest<{ Body: PutHealthInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const state = await this.service.putHealth(currentUser(request).id, request.body);
    await reply.status(200).send(ok(state));
  };

  putDiet = async (request: FastifyRequest<{ Body: PutDietInput }>, reply: FastifyReply): Promise<void> => {
    const state = await this.service.putDiet(currentUser(request).id, request.body);
    await reply.status(200).send(ok(state));
  };

  putWorkout = async (
    request: FastifyRequest<{ Body: PutWorkoutInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const state = await this.service.putWorkout(currentUser(request).id, request.body);
    await reply.status(200).send(ok(state));
  };

  complete = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await reply.status(200).send(ok(await this.service.complete(currentUser(request).id)));
  };

  getSupplementCatalog = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await reply.status(200).send(ok(await this.service.getSupplementCatalog()));
  };
}
