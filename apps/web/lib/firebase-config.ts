import type { FirebaseWebConfig } from '@/app/_components/use-google-sign-in';

/**
 * The web config the browser needs to talk to Firebase, read once on the server.
 *
 * Every value is public by design: it identifies the project, it does not
 * authorise anything. The secret side of sign in is that the server verifies the
 * returned token itself. Null when the deployment has no provider configured, in
 * which case every sign in affordance falls back to a plain link to the sign in
 * page, which explains the situation.
 */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !authDomain || !projectId) return null;
  return { apiKey, authDomain, projectId };
}
