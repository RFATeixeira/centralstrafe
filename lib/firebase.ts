import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Analytics, getAnalytics, isSupported } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const localDevFirebaseConfig = {
  apiKey: "AIzaSyCzHoCgfK8-nsTL-SxMQpPSL-UhYkng6Yo",
  authDomain: "centralstrafe.firebaseapp.com",
  projectId: "centralstrafe",
  storageBucket: "centralstrafe.firebasestorage.app",
  messagingSenderId: "687341311076",
  appId: "1:687341311076:web:85e5330b3a2b4bce36bb71",
  measurementId: "G-LYRSM0HG74",
};

const useLocalDevFallback =
  process.env.NODE_ENV !== "production" &&
  !process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    (useLocalDevFallback ? localDevFirebaseConfig.apiKey : ""),
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    (useLocalDevFallback ? localDevFirebaseConfig.authDomain : ""),
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    (useLocalDevFallback ? localDevFirebaseConfig.projectId : ""),
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    (useLocalDevFallback ? localDevFirebaseConfig.storageBucket : ""),
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
    (useLocalDevFallback ? localDevFirebaseConfig.messagingSenderId : ""),
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    (useLocalDevFallback ? localDevFirebaseConfig.appId : ""),
  measurementId:
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ??
    (useLocalDevFallback ? localDevFirebaseConfig.measurementId : ""),
};

const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.storageBucket,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId,
];

export const isFirebaseConfigured = requiredConfig.every(Boolean);

let app: FirebaseApp | null = null;

if (isFirebaseConfigured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

export const analyticsPromise: Promise<Analytics | null> =
  app && typeof window !== "undefined"
    ? isSupported()
        .then((supported) => (supported ? getAnalytics(app) : null))
        .catch(() => null)
    : Promise.resolve(null);
