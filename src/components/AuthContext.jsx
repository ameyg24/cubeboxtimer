// AuthContext.jsx - Provides authentication context and Google sign-in
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { auth, provider } from "../firebase/config";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { logger } from "../logger.js";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const startedAt = performance.now();
    // Fallback: if Firebase doesn't respond in 2s, render anyway (offline / bad config)
    const timeout = setTimeout(() => {
      logger.warn("Firebase auth did not respond within 2s; rendering without waiting further.");
      setLoading(false);
    }, 2000);
    let unsubscribe = () => {};
    try {
      if (auth) {
        unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
          clearTimeout(timeout);
          logger.info("Auth state resolved.", {
            signedIn: !!firebaseUser,
            durationMs: Math.round(performance.now() - startedAt),
          });
          setUser(firebaseUser);
          setLoading(false);
        });
      } else {
        clearTimeout(timeout);
        setLoading(false);
      }
    } catch (error) {
      logger.warn("Failed to attach Firebase auth state listener.", { error });
      clearTimeout(timeout);
      setLoading(false);
    }
    return () => { unsubscribe(); clearTimeout(timeout); };
  }, []);

  const login = useCallback(async () => {
    setAuthError("");
    if (!auth || !provider) {
      const message = "Firebase sign-in is not configured. Add a .env file with VITE_FIREBASE_* values and restart the dev server.";
      setAuthError(message);
      logger.warn(message);
      return;
    }
    logger.debug("Sign-in attempt started.");
    try {
      await signInWithPopup(auth, provider);
      logger.info("Sign-in succeeded.");
    } catch (error) {
      const message = error?.message || "Sign-in failed.";
      setAuthError(message);
      logger.warn("Firebase sign-in failed.", { error });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      logger.info("Sign-out succeeded.");
    } catch (error) {
      logger.warn("Firebase sign-out failed.", { error });
    }
  }, []);

  const value = useMemo(() => ({ user, login, logout, authError }), [user, login, logout, authError]);
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
