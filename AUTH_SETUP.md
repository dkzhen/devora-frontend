# Clerk email + password setup

This frontend uses Clerk's custom email/password flow on the existing `/auth` screen. OAuth/social buttons and strategies are intentionally not used. Console preview routes remain open during UI review; this is not a protected-route rollout.

## Clerk Dashboard checklist

1. Create a Clerk application and open **User & authentication → Email, phone, username** (labels can vary slightly in Clerk's dashboard).
2. Enable **Sign-up with email** and **Sign-in with email**; require an email address.
3. In **Password**, enable **Sign-up with password** and **Sign-in with password**.
4. Set email verification at sign-up to **Email verification code** (the custom screen prompts for that code).
5. Turn **OFF all social/OAuth connections** and **OFF any enterprise/SSO connections**. No OAuth provider is required or used by this frontend.
6. For the email+password-only sign-in implemented here, disable optional device-trust and MFA requirements in the Clerk app. The UI reports an explicit unsupported-step message if an existing account is configured to require MFA/device trust.
7. In the Clerk app's API keys section, copy its **development** publishable key and secret key. Keep production keys out of local development.

## Local configuration

1. Copy `.env.example` to `.env.local` (or the environment file your local Next.js runner loads).
2. Replace placeholders with the values from your own Clerk application:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`
   - `CLERK_SECRET_KEY=sk_test_...`
3. Never commit `.env.local` or paste the secret key into browser/client code. The secret is included only as the conventional server-side Clerk key; this frontend custom client flow does not read it.
4. Restart the Next.js dev server. Without a valid publishable key the landing page and console preview continue to render, while `/auth` shows the setup-needed version and live authentication is unavailable.

After sign-up (including email-code verification) or sign-in, the browser gets a Clerk session token and sends only `Authorization: Bearer <token>` to `GET http://127.0.0.1:8787/api/v1/users/me`. No user ID or email is submitted. The browser must be able to reach the local backend, and that backend must accept this origin's CORS request and verify Clerk tokens. Successful sync sends the user to `/console/ai`; a failed sync is shown inline and does not redirect.

References: [Clerk custom email/password flow](https://clerk.com/docs/guides/development/custom-flows/authentication/email-password), [Next.js SDK setup](https://clerk.com/docs/nextjs/getting-started/quickstart).
