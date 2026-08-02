import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

/**
 * Deterministic development seed. Safe to re-run: every write is an upsert
 * keyed on a natural key, so the same data converges rather than duplicating.
 * Never run against production.
 */
const prisma = new PrismaClient();

const DEV_USERS = [
  { phone: '+919876543210', displayName: 'Akshay', entitlement: 'FREE' as const },
  { phone: '+919876543211', displayName: 'Priya', entitlement: 'PREMIUM' as const },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

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

main()
  .catch((err: unknown) => {
    console.error('seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
