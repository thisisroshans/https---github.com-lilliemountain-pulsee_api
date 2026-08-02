import type { Equipment, ExerciseCategory, MuscleGroup } from '@prisma/client';

/**
 * Exercise catalog. Reference data, keyed by `slug` so re-seeding converges.
 *
 * `primaryMuscles` and `secondaryMuscles` drive the anatomy figure on screen 9 —
 * the ids match the muscle groups that figure can highlight.
 *
 * `isWeighted: false` means load is not meaningful, so no 1RM is estimated.
 */
export interface ExerciseSeed {
  slug: string;
  name: string;
  category: ExerciseCategory;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment[];
  howToSteps: string[];
  isWeighted: boolean;
  sortOrder: number;
}

export const EXERCISE_CATALOG: ExerciseSeed[] = [
  {
    slug: 'dumbbell-bench-press',
    name: 'Dumbbell bench press',
    category: 'PUSH',
    primaryMuscles: ['CHEST'],
    secondaryMuscles: ['SHOULDERS', 'TRICEPS'],
    equipment: ['DUMBBELL'],
    howToSteps: [
      'Sit on the bench with feet flat, dumbbells at chest height, elbows bent about 90 degrees.',
      'Brace your core, exhale and press the weights straight up until your arms are extended.',
      'Pause briefly at the top — do not lock your elbows hard.',
      'Inhale and lower under control to the start. That is one rep.',
    ],
    isWeighted: true,
    sortOrder: 10,
  },
  {
    slug: 'bent-over-row',
    name: 'Bent-over row',
    category: 'PULL',
    primaryMuscles: ['BACK', 'LATS'],
    secondaryMuscles: ['BICEPS', 'REAR_DELTS'],
    equipment: ['BARBELL', 'DUMBBELL'],
    howToSteps: [
      'Hinge at the hips with a flat back, knees softly bent, weight hanging at arm’s length.',
      'Pull towards your belly button, driving your elbows back past your ribs.',
      'Squeeze the shoulder blades together at the top.',
      'Lower under control without letting your back round.',
    ],
    isWeighted: true,
    sortOrder: 20,
  },
  {
    slug: 'overhead-shoulder-press',
    name: 'Overhead shoulder press',
    category: 'PUSH',
    primaryMuscles: ['SHOULDERS'],
    secondaryMuscles: ['TRICEPS', 'ABS'],
    equipment: ['DUMBBELL', 'BARBELL'],
    howToSteps: [
      'Stand or sit tall with the weight at shoulder height, palms facing forward.',
      'Brace your core so your lower back does not arch.',
      'Press overhead until your arms are straight, biceps beside your ears.',
      'Lower under control back to shoulder height.',
    ],
    isWeighted: true,
    sortOrder: 30,
  },
  {
    slug: 'lat-pulldown',
    name: 'Lat pulldown',
    category: 'PULL',
    primaryMuscles: ['LATS', 'BACK'],
    secondaryMuscles: ['BICEPS'],
    equipment: ['CABLE', 'MACHINE'],
    howToSteps: [
      'Sit with thighs secured, grip the bar slightly wider than shoulder width.',
      'Lean back very slightly and pull the bar to your upper chest.',
      'Drive your elbows down rather than pulling with your hands.',
      'Return under control until your arms are fully extended.',
    ],
    isWeighted: true,
    sortOrder: 40,
  },
  {
    slug: 'bicep-curl',
    name: 'Bicep curl',
    category: 'PULL',
    primaryMuscles: ['BICEPS'],
    secondaryMuscles: ['FOREARMS'],
    equipment: ['DUMBBELL', 'BARBELL'],
    howToSteps: [
      'Stand tall with weights at your sides, palms facing forward.',
      'Curl up without swinging, keeping your elbows pinned to your ribs.',
      'Squeeze at the top.',
      'Lower slowly — the lowering half builds most of the muscle.',
    ],
    isWeighted: true,
    sortOrder: 50,
  },
  {
    slug: 'tricep-extension',
    name: 'Tricep extension',
    category: 'PUSH',
    primaryMuscles: ['TRICEPS'],
    secondaryMuscles: [],
    equipment: ['DUMBBELL', 'CABLE'],
    howToSteps: [
      'Hold the weight overhead or at a cable, upper arms vertical.',
      'Keep your elbows still and pointing forward.',
      'Extend until your arms are straight.',
      'Lower under control to a deep stretch.',
    ],
    isWeighted: true,
    sortOrder: 60,
  },
  {
    slug: 'goblet-squat',
    name: 'Goblet squat',
    category: 'LEGS',
    primaryMuscles: ['QUADS', 'GLUTES'],
    secondaryMuscles: ['HAMSTRINGS', 'ABS'],
    equipment: ['DUMBBELL', 'KETTLEBELL'],
    howToSteps: [
      'Hold a single weight at chest height, elbows tucked in.',
      'Stand with feet shoulder-width apart, toes turned slightly out.',
      'Sit down between your hips, keeping your chest tall.',
      'Drive through mid-foot to stand, squeezing your glutes at the top.',
    ],
    isWeighted: true,
    sortOrder: 70,
  },
  {
    slug: 'romanian-deadlift',
    name: 'Romanian deadlift',
    category: 'LEGS',
    primaryMuscles: ['HAMSTRINGS', 'GLUTES'],
    secondaryMuscles: ['LOWER_BACK', 'BACK'],
    equipment: ['BARBELL', 'DUMBBELL'],
    howToSteps: [
      'Stand tall holding the weight in front of your thighs.',
      'Push your hips back, letting the weight travel down your legs.',
      'Stop when you feel a strong hamstring stretch, back still flat.',
      'Drive your hips forward to stand.',
    ],
    isWeighted: true,
    sortOrder: 80,
  },
  {
    slug: 'push-up',
    name: 'Push-up',
    category: 'PUSH',
    primaryMuscles: ['CHEST'],
    secondaryMuscles: ['TRICEPS', 'SHOULDERS', 'ABS'],
    equipment: ['BODYWEIGHT', 'NONE'],
    howToSteps: [
      'Set your hands slightly wider than your shoulders, body in a straight line.',
      'Brace your glutes and core so your hips do not sag.',
      'Lower until your chest is just above the floor.',
      'Press back up, keeping your elbows about 45 degrees from your body.',
    ],
    isWeighted: false,
    sortOrder: 90,
  },
  {
    slug: 'plank',
    name: 'Plank',
    category: 'CORE',
    primaryMuscles: ['ABS'],
    secondaryMuscles: ['OBLIQUES', 'LOWER_BACK'],
    equipment: ['BODYWEIGHT', 'NONE'],
    howToSteps: [
      'Rest on your forearms with elbows under your shoulders.',
      'Squeeze your glutes and brace as if about to be punched.',
      'Keep a straight line from head to heels.',
      'Breathe steadily and hold for the prescribed time.',
    ],
    isWeighted: false,
    sortOrder: 100,
  },
  {
    slug: 'brisk-walk',
    name: 'Brisk walk',
    category: 'CARDIO',
    primaryMuscles: ['CARDIO'],
    secondaryMuscles: ['CALVES', 'QUADS'],
    equipment: ['NONE'],
    howToSteps: [
      'Walk at a pace where you can talk but not sing.',
      'Keep your posture tall and your arms swinging naturally.',
      'Hold the pace for the prescribed duration.',
    ],
    isWeighted: false,
    sortOrder: 110,
  },
  {
    slug: 'surya-namaskar',
    name: 'Surya Namaskar',
    category: 'MOBILITY',
    primaryMuscles: ['FULL_BODY'],
    secondaryMuscles: ['ABS', 'SHOULDERS'],
    equipment: ['BODYWEIGHT', 'NONE'],
    howToSteps: [
      'Begin standing tall in prayer position, breathing evenly.',
      'Flow through the twelve positions, one breath per movement.',
      'Keep the transitions smooth rather than rushed.',
      'Complete the round on both sides before resting.',
    ],
    isWeighted: false,
    sortOrder: 120,
  },
];
