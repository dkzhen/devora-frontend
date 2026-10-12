export const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

export const CLERK_ENABLED =
  (CLERK_PUBLISHABLE_KEY.startsWith("pk_test_") || CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")) &&
  !CLERK_PUBLISHABLE_KEY.includes("YOUR_");
