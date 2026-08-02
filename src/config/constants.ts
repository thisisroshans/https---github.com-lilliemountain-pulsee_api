/**
 * Non-secret application constants. Anything that would otherwise be a magic
 * number or magic string in business logic belongs here.
 */

export const API_PREFIX = '/api/v1';

/** Product default. Users may override; all "today"/streak math uses the user tz. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_LOCALE = 'en-IN';
export const DEFAULT_CURRENCY = 'INR';

// --- Pagination -------------------------------------------------------------
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// --- Free tier / entitlements ----------------------------------------------
export const FREE_TIER_DAILY_COACH_MESSAGES = 20;
export const TRIAL_DURATION_DAYS = 7;

// --- Auth -------------------------------------------------------------------
export const OTP_CODE_LENGTH = 6;
/** Max OTP *requests* per phone within the window below. */
export const OTP_REQUESTS_PER_PHONE = 5;
export const OTP_REQUEST_WINDOW_SECONDS = 15 * 60;

// --- Uploads ----------------------------------------------------------------
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

// --- HTTP -------------------------------------------------------------------
export const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB for JSON routes
export const REQUEST_ID_HEADER = 'x-request-id';

// --- Cache TTLs (seconds) ---------------------------------------------------
export const CACHE_TTL = {
  supplementCatalog: 60 * 60,
  exerciseCatalog: 60 * 60,
  activePlan: 5 * 60,
  dailyTargets: 5 * 60,
} as const;
