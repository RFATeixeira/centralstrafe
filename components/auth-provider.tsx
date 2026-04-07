"use client";

import {
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithPopup,
  setPersistence,
  signOut,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { Role, UserProfile } from "@/lib/roles";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  role: Role | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const googleProvider = new GoogleAuthProvider();

async function ensureUserProfile(nextUser: User) {
  if (!db) {
    return;
  }

  try {
    const profileRef = doc(db, "users", nextUser.uid);
    const snapshot = await getDoc(profileRef);

    if (!snapshot.exists()) {
      await setDoc(profileRef, {
        uid: nextUser.uid,
        email: nextUser.email ?? null,
        displayName: nextUser.displayName ?? null,
        role: "user",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    await setDoc(
      profileRef,
      {
        uid: nextUser.uid,
        email: nextUser.email ?? null,
        displayName: nextUser.displayName ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn("Nao foi possivel sincronizar o perfil no Firestore.", error);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(Boolean(auth));
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    if (!auth) {
      return;
    }

    void setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.warn("Nao foi possivel ajustar a persistencia do login.", error);
    });

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        void ensureUserProfile(nextUser);
      }
      if (!nextUser) {
        setProfile(null);
        setLoadingProfile(false);
      }
      setLoadingAuth(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!db || !user) {
      return;
    }

    const firestore = db;

    let unsubscribeProfile: (() => void) | undefined;
    const loadProfile = async () => {
      setLoadingProfile(true);

      try {
        const profileRef = doc(firestore, "users", user.uid);
        const snapshot = await getDoc(profileRef);

        if (!snapshot.exists()) {
          await setDoc(profileRef, {
            uid: user.uid,
            email: user.email ?? null,
            displayName: user.displayName ?? null,
            role: "user",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        unsubscribeProfile = onSnapshot(profileRef, (docSnapshot) => {
          if (!docSnapshot.exists()) {
            setProfile(null);
            setLoadingProfile(false);
            return;
          }

          const data = docSnapshot.data() as UserProfile;
          setProfile({
            uid: data.uid,
            email: data.email ?? user.email ?? null,
            displayName: data.displayName ?? user.displayName ?? null,
            role: data.role ?? "user",
          });
          setLoadingProfile(false);
        });
      } catch {
        setLoadingProfile(false);
      }
    };

    void loadProfile();

    return () => {
      unsubscribeProfile?.();
    };
  }, [user]);

  const loginWithGoogle = async () => {
    if (!auth) {
      return;
    }

    await setPersistence(auth, browserLocalPersistence);
    const credential = await signInWithPopup(auth, googleProvider);
    await ensureUserProfile(credential.user);
  };

  const logout = async () => {
    if (!auth) {
      return;
    }

    await signOut(auth);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      role: profile?.role ?? null,
      loading: loadingAuth || loadingProfile,
      loginWithGoogle,
      logout,
    }),
    [loadingAuth, loadingProfile, profile, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthSession must be used within AuthProvider");
  }

  return context;
}
