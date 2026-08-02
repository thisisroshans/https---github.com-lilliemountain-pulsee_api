import type { SupplementKind } from '@prisma/client';

/**
 * Supplement catalog (screen 5). Reference data, not user data: seeded on every
 * deploy and keyed by `slug` so re-running converges rather than duplicating.
 *
 * `defaultProteinPerServingG` is a starting point the user can edit — brands
 * differ, and their edit is copied onto their own row so a later catalog change
 * never silently rewrites someone's protein target.
 */
export interface SupplementSeed {
  slug: string;
  name: string;
  kind: SupplementKind;
  defaultProteinPerServingG: number;
  sortOrder: number;
}

export const SUPPLEMENT_CATALOG: SupplementSeed[] = [
  {
    slug: 'whey-protein',
    name: 'Whey protein',
    kind: 'PROTEIN',
    defaultProteinPerServingG: 24,
    sortOrder: 10,
  },
  {
    slug: 'plant-protein',
    name: 'Plant protein',
    kind: 'PROTEIN',
    defaultProteinPerServingG: 21,
    sortOrder: 20,
  },
  { slug: 'casein', name: 'Casein', kind: 'PROTEIN', defaultProteinPerServingG: 24, sortOrder: 30 },
  { slug: 'mass-gainer', name: 'Mass gainer', kind: 'PROTEIN', defaultProteinPerServingG: 30, sortOrder: 40 },
  { slug: 'creatine', name: 'Creatine', kind: 'OTHER', defaultProteinPerServingG: 0, sortOrder: 50 },
  { slug: 'bcaa-eaa', name: 'BCAA / EAA', kind: 'OTHER', defaultProteinPerServingG: 0, sortOrder: 60 },
  { slug: 'multivitamin', name: 'Multivitamin', kind: 'OTHER', defaultProteinPerServingG: 0, sortOrder: 70 },
  { slug: 'omega-3', name: 'Omega-3', kind: 'OTHER', defaultProteinPerServingG: 0, sortOrder: 80 },
];
