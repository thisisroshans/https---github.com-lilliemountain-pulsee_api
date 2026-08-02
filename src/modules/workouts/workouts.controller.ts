import type { FastifyReply, FastifyRequest } from 'fastify';

import { ok, paginated } from '../../shared/http/envelope.js';
import { currentUser } from '../../shared/middleware/auth.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { UserContext, WorkoutsService } from './workouts.service.js';
import type {
  CompleteSessionInput,
  ListExercisesQuery,
  ListSessionsQuery,
  LogSetInput,
  StartSessionInput,
} from './workouts.schema.js';

interface SessionParams {
  sessionId: string;
}
interface ExerciseParams {
  exerciseId: string;
}
interface SetParams extends SessionParams {
  setId: string;
}
interface HistoryQuery {
  limit: number;
  cursor?: string;
}

export class WorkoutsController {
  constructor(
    private readonly service: WorkoutsService,
    private readonly users: UsersRepository,
  ) {}

  listExercises = async (
    request: FastifyRequest<{ Querystring: ListExercisesQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await reply.status(200).send(ok(await this.service.listExercises(request.query)));
  };

  getExercise = async (
    request: FastifyRequest<{ Params: ExerciseParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    await reply.status(200).send(ok(await this.service.getExercise(context, request.params.exerciseId)));
  };

  getExerciseHistory = async (
    request: FastifyRequest<{ Params: ExerciseParams; Querystring: HistoryQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    const page = await this.service.getExerciseHistory(
      context,
      request.params.exerciseId,
      request.query.limit,
      request.query.cursor,
    );

    await reply.status(200).send(paginated(page.items, page.pagination));
  };

  getExerciseProgress = async (
    request: FastifyRequest<{ Params: ExerciseParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    const progress = await this.service.getExerciseProgress(context, request.params.exerciseId);
    await reply.status(200).send(ok(progress));
  };

  startSession = async (
    request: FastifyRequest<{ Body: StartSessionInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    const { session, created } = await this.service.startSession(context, request.body);

    // 201 for a new session, 200 when an already-open one is resumed.
    await reply.status(created ? 201 : 200).send(ok(session));
  };

  getActiveSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const context = await this.contextOf(request);
    await reply.status(200).send(ok(await this.service.getActiveSession(context)));
  };

  listSessions = async (
    request: FastifyRequest<{ Querystring: ListSessionsQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    const page = await this.service.listSessions(context, request.query);
    await reply.status(200).send(paginated(page.items, page.pagination));
  };

  getSession = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    await reply.status(200).send(ok(await this.service.getSession(context, request.params.sessionId)));
  };

  logSet = async (
    request: FastifyRequest<{ Params: SessionParams; Body: LogSetInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    const session = await this.service.logSet(context, request.params.sessionId, request.body);
    await reply.status(200).send(ok(session));
  };

  deleteSet = async (request: FastifyRequest<{ Params: SetParams }>, reply: FastifyReply): Promise<void> => {
    const context = await this.contextOf(request);
    const session = await this.service.deleteSet(context, request.params.sessionId, request.params.setId);
    await reply.status(200).send(ok(session));
  };

  completeSession = async (
    request: FastifyRequest<{ Params: SessionParams; Body: CompleteSessionInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    const session = await this.service.completeSession(context, request.params.sessionId, request.body);
    await reply.status(200).send(ok(session));
  };

  abandonSession = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    const session = await this.service.abandonSession(context, request.params.sessionId);
    await reply.status(200).send(ok(session));
  };

  deleteSession = async (
    request: FastifyRequest<{ Params: SessionParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const context = await this.contextOf(request);
    await this.service.deleteSession(context, request.params.sessionId);
    await reply.status(204).send();
  };

  /**
   * The user's timezone decides which calendar day a session belongs to, so it
   * is resolved once per request rather than assumed.
   */
  private async contextOf(request: FastifyRequest): Promise<UserContext> {
    const userId = currentUser(request).id;
    return { userId, timezone: await this.users.findTimezone(userId) };
  }
}
