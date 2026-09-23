/**
 * AgroPulse — Hook de Comandos de Riego en Tiempo Real
 *
 * Suscripción Realtime a la tabla `irrigation_commands` para
 * reaccionar cuando el worker actualiza el estado de los comandos.
 * También provee la función para enviar nuevos comandos.
 */
import { useEffect, useState, useCallback } from 'react';
import { generateUUID } from '@/lib/utils/uuid';
import { supabase } from '@/lib/supabase';
import { IrrigationCommand, CommandAction } from '@/lib/types/database';
import { useAuth } from './useAuth';

interface UseRealtimeCommandsOptions {
  /** ID de la válvula a monitorear */
  valveId: string;
  /** Cantidad máxima de comandos a cargar */
  limit?: number;
}

interface UseRealtimeCommandsResult {
  /** Lista de comandos ordenados por created_at DESC */
  commands: IrrigationCommand[];
  /** Indica si hay un comando pendiente en vuelo */
  hasPending: boolean;
  /** Estado de carga */
  loading: boolean;
  /** Error si hubo problema */
  error: string | null;
  /** Enviar un nuevo comando de riego */
  sendCommand: (action: CommandAction, durationMin?: number) => Promise<{ error: string | null }>;
  /** Cancelar un comando pendiente */
  cancelCommand: (commandId: string) => Promise<{ error: string | null }>;
}

export function useRealtimeCommands({
  valveId,
  limit = 20,
}: UseRealtimeCommandsOptions): UseRealtimeCommandsResult {
  const { user } = useAuth();
  const [commands, setCommands] = useState<IrrigationCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carga inicial de comandos
  const loadCommands = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from('irrigation_commands')
        .select('*')
        .eq('valve_id', valveId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (queryError) {
        setError(queryError.message);
        return;
      }

      setCommands(data as IrrigationCommand[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [valveId, limit]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  // Suscripción Realtime a cambios en irrigation_commands
  useEffect(() => {
    const channel = supabase
      .channel(`commands-valve-${valveId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT y UPDATE
          schema: 'public',
          table: 'irrigation_commands',
          filter: `valve_id=eq.${valveId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newCmd = payload.new as IrrigationCommand;
            setCommands((prev) => [newCmd, ...prev].slice(0, limit));
          } else if (payload.eventType === 'UPDATE') {
            const updatedCmd = payload.new as IrrigationCommand;
            setCommands((prev) =>
              prev.map((cmd) => (cmd.id === updatedCmd.id ? updatedCmd : cmd))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [valveId, limit]);

  // Verificar si hay un comando pendiente
  const hasPending = commands.some((cmd) => cmd.status === 'pending');

  // Enviar nuevo comando
  const sendCommand = useCallback(
    async (action: CommandAction, durationMin?: number): Promise<{ error: string | null }> => {
      if (!user) {
        return { error: 'No hay sesión de usuario activa' };
      }

      if (hasPending) {
        return { error: 'Ya hay un comando pendiente para esta válvula' };
      }

      const clientRequestId = generateUUID();

      const insertData: any = {
        valve_id: valveId,
        user_id: user.id,
        action,
        status: 'pending',
        client_request_id: clientRequestId,
      };

      if (durationMin !== undefined) {
        insertData.duration_min = durationMin;
      }

      const { error: insertError } = await supabase
        .from('irrigation_commands')
        .insert(insertData);

      if (insertError) {
        // Manejar error de constraint (comando duplicado)
        if (insertError.message.includes('uq_valve_pending')) {
          return { error: 'Ya hay un comando pendiente para esta válvula' };
        }
        return { error: insertError.message };
      }

      return { error: null };
    },
    [user, valveId, hasPending]
  );

  // Cancelar comando
  const cancelCommand = useCallback(
    async (commandId: string): Promise<{ error: string | null }> => {
      if (!user) {
        return { error: 'No hay sesión de usuario activa' };
      }

      const { error: updateError } = await supabase
        .from('irrigation_commands')
        .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
        .eq('id', commandId)
        .eq('status', 'pending');

      if (updateError) {
        return { error: updateError.message };
      }

      return { error: null };
    },
    [user]
  );

  return {
    commands,
    hasPending,
    loading,
    error,
    sendCommand,
    cancelCommand,
  };
}
