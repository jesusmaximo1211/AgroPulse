/**
 * AgroPulse — Hook de Autenticación
 *
 * Provee contexto de autenticación con Supabase Auth.
 * Incluye estado de sesión, usuario, membresía y funciones de login/logout.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Membership, MembershipRole, Organization } from '@/lib/types/database';

// ============================================================================
// Tipos
// ============================================================================

interface AuthContextType {
  /** Sesión actual de Supabase */
  session: Session | null;
  /** Usuario autenticado */
  user: User | null;
  /** Membresía del usuario en la organización activa */
  membership: Membership | null;
  /** Organización activa */
  organization: Organization | null;
  /** Rol del usuario en la organización activa */
  role: MembershipRole | null;
  /** Estado de carga */
  loading: boolean;
  /** Login con email y contraseña */
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  /** Cerrar sesión */
  signOut: () => Promise<void>;
}

// ============================================================================
// Contexto
// ============================================================================

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  membership: null,
  organization: null,
  role: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
});

// ============================================================================
// Provider
// ============================================================================

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  // Cargar membresía y organización del usuario
  const loadUserData = useCallback(async (userId: string) => {
    try {
      // Obtener la primera membresía del usuario (simplificación: 1 org)
      const { data: membershipData, error: membershipError } = await supabase
        .from('memberships')
        .select('*, organizations(*)')
        .eq('user_id', userId)
        .limit(1)
        .single();

      if (membershipError) {
        console.error('Error cargando membresía:', membershipError.message);
        return;
      }

      if (membershipData) {
        setMembership(membershipData as Membership);
        setOrganization(
          (membershipData as Record<string, unknown>).organizations as Organization
        );
      }
    } catch (err) {
      console.error('Error en loadUserData:', err);
    }
  }, []);

  // Inicializar sesión y escuchar cambios
  useEffect(() => {
    // Obtener sesión actual
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        loadUserData(currentSession.user.id);
      }
      setLoading(false);
    });

    // Escuchar cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          await loadUserData(newSession.user.id);
        } else {
          setMembership(null);
          setOrganization(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [loadUserData]);

  // Login
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }, []);

  // Logout
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setMembership(null);
    setOrganization(null);
  }, []);

  const role = membership?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        membership,
        organization,
        role,
        loading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
}
