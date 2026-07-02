// AuthContext.jsx - Provides authentication context and Gmail login
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { auth, provider } from "../firebase/config";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    // Fallback: if Firebase doesn't respond in 2s, render anyway (offline / bad config)
    const timeout = setTimeout(() => setLoading(false), 2000);
    let unsubscribe = () => {};
    try {
      if (auth) {
        unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
          clearTimeout(timeout);
          setUser(firebaseUser);
          setLoading(false);
        });
      } else {
        clearTimeout(timeout);
        setLoading(false);
      }
    } catch {
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
      console.warn(message);
      return;
    }
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const message = error?.message || "Sign-in failed.";
      setAuthError(message);
      console.warn("Firebase sign-in failed.", error);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const value = useMemo(() => ({ user, login, logout, authError }), [user, login, logout, authError]);
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
