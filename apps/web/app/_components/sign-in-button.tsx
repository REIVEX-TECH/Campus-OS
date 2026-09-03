'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sign in with Google, via Firebase.
 *
 * The Firebase SDK is loaded from Google's own ESM build, on click, rather than
 * bundled. It is a large library used by exactly one interaction, so bundling it
 * would put roughly a hundred kilobytes in front of every reader of a public
 * timetable to serve the few who sign in. Loading it on demand costs the signer
 * one fetch and costs everyone else nothing. Signing in already requires
 * reaching Google, so this adds no dependency the flow did not already have.
 *
 * The SDK's only job is to return a token proving the person controls a Google
 * account. The server verifies that token itself and mints its own session; the
 * provider token is never stored and never becomes the session.
 */

const FIREBASE_VERSION = '12.0.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
};

type Status = 'idle' | 'working' | 'failed';

export function SignInButton({
  config,
  labels,
}: {
  config: FirebaseWebConfig;
  labels: { signIn: string; working: string; failed: string };
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');

  async function signIn(): Promise<void> {
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
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={signIn}
        disabled={status === 'working'}
        className="ios-pressable ios-card rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {status === 'working' ? labels.working : labels.signIn}
      </button>
      {status === 'failed' ? (
        <p className="text-sm text-muted-foreground" role="status">
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
