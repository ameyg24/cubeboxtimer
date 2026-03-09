// AuthContext.jsx - Provides authentication context and Gmail login
import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, provider } from "../firebase/config";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
    } catch (e) {
      clearTimeout(timeout);
      setLoading(false);
    }
    return () => { unsubscribe(); clearTimeout(timeout); };
  }, []);

  const login = async () => {
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const value = { user, login, logout };
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
