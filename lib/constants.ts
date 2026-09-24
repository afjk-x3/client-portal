export const APP_NAME = "Client Portal";

export const MAX_ITEMS_PER_REQUEST = 100;
export const MAX_FILES_PER_ITEM = 20;

/**
 * Text limits in characters. The database check constraints in
 * supabase/migrations use the same numbers; forms use them as maxLength.
 */
export const LIMITS = {
  firmName: 120,
  name: 200,
  description: 2000,
  textAnswer: 5000,
  reviewNote: 1000,
  filename: 255,
} as const;
