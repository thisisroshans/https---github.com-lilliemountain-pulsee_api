import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

import { EXERCISE_CATALOG } from './seed-data/exercises.js';
import { SUPPLEMENT_CATALOG } from './seed-data/supplements.js';

/**
 * Deterministic seed. Safe to re-run: every write is an upsert keyed on a
 * natural key, so the same data converges rather than duplicating.
 *
 * The supplement catalog is real reference data and is seeded everywhere.
 * Sample users are development-only and never touch production.
 */
const prisma = new PrismaClient();

const DEV_USERS = [
  { phone: '+919876543210', displayName: 'Akshay', entitlement: 'FREE' as const },
  { phone: '+919876543211', displayName: 'Priya', entitlement: 'PREMIUM' as const },
];

async function seedSupplementCatalog(): Promise<void> {
  for (const supplement of SUPPLEMENT_CATALOG) {
    await prisma.supplement.upsert({
      where: { slug: supplement.slug },
      update: {
        name: supplement.name,
        kind: supplement.kind,
        defaultProteinPerServingG: supplement.defaultProteinPerServingG,
        sortOrder: supplement.sortOrder,
        isActive: true,
      },
      create: { id: uuidv7(), ...supplement },
    });
  }

  console.log(`seeded ${String(SUPPLEMENT_CATALOG.length)} supplements`);
}

async function seedExerciseCatalog(): Promise<void> {
  for (const exercise of EXERCISE_CATALOG) {
    await prisma.exercise.upsert({
      where: { slug: exercise.slug },
      update: { ...exercise, isActive: true },
      create: { id: uuidv7(), ...exercise },
    });
  }

  console.log(`seeded ${String(EXERCISE_CATALOG.length)} exercises`);
}

async function seedDevUsers(): Promise<void> {
  for (const user of DEV_USERS) {
    const record = await prisma.user.upsert({
      where: { phone: user.phone },
      update: { displayName: user.displayName, entitlement: user.entitlement },
      create: {
        id: uuidv7(),
        phone: user.phone,
        displayName: user.displayName,
        entitlement: user.entitlement,
        phoneVerifiedAt: new Date(),
      },
    });
    console.log(`seeded user ${record.displayName ?? record.id} (${record.entitlement})`);
  }
}

async function main(): Promise<void> {
  await seedSupplementCatalog();
  await seedExerciseCatalog();

  if (process.env.NODE_ENV === 'production') {
    console.log('production: skipping sample users');
    return;
  }

  await seedDevUsers();
}

main()
  .catch((err: unknown) => {
    console.error('seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
