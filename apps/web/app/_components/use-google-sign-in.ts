'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sign in with Google, via Firebase, from anywhere in the app.
 *
 * The Firebase SDK is loaded from Google's own ESM build, on click, rather than
 * bundled. It is a large library used by exactly one interaction, so bundling it
 * would put roughly a hundred kilobytes in front of every reader of a public
 * timetable to serve the few who sign in. Loading it on demand costs the signer
 * one fetch and costs everyone else nothing. Signing in already requires
 * reaching Google, so this adds no dependency the flow did not already have.
 *
 * This lives in a hook rather than in the button because the sign in affordance
 * now appears in two places: the sign in page, and the account row in the
 * sidebar, which is on every page. Only the string in the dynamic import is
 * shared, so putting it in the sidebar keeps the SDK out of every bundle exactly
 * as it was before.
 *
 * The SDK's only job is to return a token proving the person controls a Google
 * account. The server verifies that token itself and mints its own session; the
 * provider token is never stored and never becomes the session.
 */

const FIREBASE_VERSION = '12.0.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

/**
 * The web config the browser needs to talk to Firebase. Every value is public by
 * design: it identifies the project, it does not authorise anything. The secret
 * side of sign in is that the server verifies the returned token itself.
 */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
};

export type SignInStatus = 'idle' | 'working' | 'failed';

export function useGoogleSignIn(config: FirebaseWebConfig): {
  status: SignInStatus;
  signIn: () => Promise<void>;
} {
  const router = useRouter();
  const [status, setStatus] = useState<SignInStatus>('idle');

  const signIn = useCallback(async (): Promise<void> => {
    setStatus('working');
    try {
      const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup }] =
        await Promise.all([
          import(/* webpackIgnore: true */ `${CDN}/firebase-app.js`),
          import(/* webpackIgnore: true */ `${CDN}/firebase-auth.js`),
        ]);

      const app = getApps().length ? getApps()[0] : initializeApp(config);
      const credential = await signInWithPopup(getAuth(app), new GoogleAuthProvider());
      const idToken = await credential.user.getIdToken();

      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!response.ok) throw new Error('session refused');

      // The page is server rendered, so refreshing is what makes it show the
      // signed in state rather than storing anything in the browser.
      router.refresh();
      setStatus('idle');
    } catch {
      // Includes the reader simply closing the Google popup, so this stays a
      // quiet retryable state rather than an alarming error.
      setStatus('failed');
    }
  }, [config, router]);

  return { status, signIn };
}
