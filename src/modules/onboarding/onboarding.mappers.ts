/**
 * Enum translation between the API contract (lowercase, e.g. `lose_weight`) and
 * Prisma (SCREAMING_SNAKE, e.g. `LOSE_WEIGHT`).
 *
 * Both conventions are deliberate — §5 of the handoff fixes the database style,
 * §6 the wire style — so exactly one place is allowed to bridge them. The
 * conversion is mechanical rather than a hand-written lookup, which means a new
 * enum value cannot be forgotten here.
 *
 * The casts are unavoidable: the caller knows which enum it wants, and the
 * schemas on both sides have already constrained the value to that set.
 */

/** `lose_weight` -> `LOSE_WEIGHT` */
export function toPrismaEnum<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

/** `LOSE_WEIGHT` -> `lose_weight` */
export function toApiEnum<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

export function toPrismaEnums<T extends string>(values: readonly string[]): T[] {
  return values.map((value) => toPrismaEnum<T>(value));
}

export function toApiEnums<T extends string>(values: readonly string[]): T[] {
  return values.map((value) => toApiEnum<T>(value));
}
