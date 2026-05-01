import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import type { Auth } from 'firebase/auth';

export let auth: Auth;
export let googleProvider: GoogleAuthProvider;

export interface FirebaseRuntimeConfig {
  firebaseApiKey:            string;
  firebaseAuthDomain:        string;
  firebaseProjectId:         string;
  firebaseStorageBucket:     string;
  firebaseMessagingSenderId: string;
  firebaseAppId:             string;
  googleHd?:                 string;
}

export function initFirebase(cfg: FirebaseRuntimeConfig): void {
  const app = initializeApp({
    apiKey:            cfg.firebaseApiKey,
    authDomain:        cfg.firebaseAuthDomain,
    projectId:         cfg.firebaseProjectId,
    storageBucket:     cfg.firebaseStorageBucket,
    messagingSenderId: cfg.firebaseMessagingSenderId,
    appId:             cfg.firebaseAppId,
  });
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  if (cfg.googleHd) googleProvider.setCustomParameters({ hd: cfg.googleHd });
}
