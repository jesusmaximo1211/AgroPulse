/**
 * AgroPulse — Worker Consumidor
 *
 * Consume eventos de Redpanda/Kafka y persiste en Supabase:
 *
 * 1. Topic "sensor-readings":
 *    - Inserta lecturas en la tabla `readings`
 *    - Evalúa umbrales y genera alertas si hay condición anómala
 *
 * 2. Topic "irrigation-commands":
 *    - Procesa comandos de riego pendientes
 *    - Actualiza status a `applied` (90%) o `failed` (10%) con delay <= 5s
 *    - Si exitoso, actualiza `valves.state`
 *
 * Usa la clave `service_role` de Supabase para bypass de RLS.
 */

const { Kafka } = require("kafkajs");
const { createClient } = require("@supabase/supabase-js");

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const TOPIC_READINGS = process.env.TOPIC_READINGS || "sensor-readings";
const TOPIC_COMMANDS = process.env.TOPIC_COMMANDS || "irrigation-commands";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Faltan variables SUPABASE_URL o SUPABASE_SERVICE_KEY");
  process.exit(1);
}

// Cliente Supabase con service_role (bypass RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Cache de umbrales por estación para evitar queries repetidas
const thresholdsCache = new Map();

// ---------------------------------------------------------------------------
// Funciones auxiliares
// ---------------------------------------------------------------------------

/**
 * Obtiene los umbrales del lote asociado a una estación.
 * Cachea el resultado para evitar queries repetidas.
 */
async function getThresholds(stationId) {
  if (thresholdsCache.has(stationId)) {
    return thresholdsCache.get(stationId);
  }

  const { data, error } = await supabase
    .from("stations")
    .select("plot_id, plots(id, threshold_min, threshold_max)")
    .eq("id", stationId)
    .single();

  if (error || !data) {
    console.error(`⚠️  No se encontró estación ${stationId}:`, error?.message);
    return null;
  }

  const thresholds = {
    plot_id: data.plot_id,
    threshold_min: data.plots.threshold_min,
    threshold_max: data.plots.threshold_max,
  };

  thresholdsCache.set(stationId, thresholds);
  return thresholds;
}

/**
 * Evalúa si la lectura genera una alerta y la persiste.
 */
async function evaluateAlert(reading, thresholds) {
  const { moisture_pct } = reading;
  const { plot_id, threshold_min, threshold_max } = thresholds;

  let alertType = null;
  let message = null;

  if (moisture_pct < threshold_min) {
    alertType = "dry";
    message = `Humedad crítica baja: ${moisture_pct}% (mínimo: ${threshold_min}%). Lote requiere riego.`;
  } else if (moisture_pct >= threshold_max) {
    alertType = "wet";
    message = `Humedad excesiva: ${moisture_pct}% (máximo: ${threshold_max}%). Posible anegamiento.`;
  }

  if (alertType) {
    // Solo crear alerta si no hay una reciente del mismo tipo (últimos 30 min)
    const { data: recentAlerts } = await supabase
      .from("alerts")
      .select("id")
      .eq("plot_id", plot_id)
      .eq("type", alertType)
      .eq("acknowledged", false)
      .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .limit(1);

    if (!recentAlerts || recentAlerts.length === 0) {
      const { error } = await supabase.from("alerts").insert({
        plot_id,
        type: alertType,
        message,
      });

      if (error) {
        console.error("❌ Error insertando alerta:", error.message);
      } else {
        console.log(`🚨 Alerta [${alertType}] generada para lote ${plot_id}`);
      }
    }
  }
}

/**
 * Procesa un comando de riego: actualiza estado a applied/failed y la válvula.
 */
async function processIrrigationCommand(commandData) {
  const { command_id, valve_id, action, duration_min, user_id } = commandData;

  // Simular delay de procesamiento (1-5 segundos)
  const delay = 1000 + Math.random() * 4000;
  await new Promise((r) => setTimeout(r, delay));

  // RF-17: Verificar si fue cancelado durante el delay
  const { data: currentCmd } = await supabase
    .from("irrigation_commands")
    .select("status")
    .eq("id", command_id)
    .single();

  if (currentCmd && currentCmd.status === "cancelled") {
    console.log(`🚫 Comando ${command_id} fue cancelado por el usuario. Abortando.`);
    return;
  }

  // 90% éxito, 10% fallo
  const success = Math.random() > 0.1;
  const newStatus = success ? "applied" : "failed";

  // Actualizar el comando
  const { error: cmdError } = await supabase
    .from("irrigation_commands")
    .update({
      status: newStatus,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", command_id);

  if (cmdError) {
    console.error(
      `❌ Error actualizando comando ${command_id}:`,
      cmdError.message
    );
    return;
  }

  // Si exitoso, actualizar el estado de la válvula
  if (success) {
    const newState = action === "open" ? "open" : "closed";
    const { error: valveError } = await supabase
      .from("valves")
      .update({
        state: newState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", valve_id);

    if (valveError) {
      console.error(
        `❌ Error actualizando válvula ${valve_id}:`,
        valveError.message
      );
      console.log(
        `✅ Comando ${command_id} → ${newStatus}. Válvula ${valve_id} → ${newState}`
      );

      // RF-14: Duración de riego (Simulada: 1 minuto = 1 segundo real)
      if (newState === "open" && duration_min) {
        console.log(`⏱️ Programando cierre de válvula ${valve_id} en ${duration_min} minutos simulados (${duration_min}s reales)...`);
        setTimeout(async () => {
          const { randomUUID } = require('crypto');
          const clientRequestId = randomUUID();
          
          console.log(`🔄 Generando comando automático de cierre para válvula ${valve_id}...`);
          
          // Insertamos un nuevo comando de cierre en pending. El polling loop se encargará de procesarlo.
          const { error: insertError } = await supabase
            .from("irrigation_commands")
            .insert({
              valve_id,
              user_id,
              action: "close",
              status: "pending",
              client_request_id: clientRequestId
            });
            
          if (insertError) {
            console.error(`❌ Error creando comando de cierre automático:`, insertError.message);
          }
        }, duration_min * 1000);
      }
    }
  } else {
    console.log(`⚠️  Comando ${command_id} → FAILED (simulado)`);

    // Generar alerta de fallo
    const { data: valve } = await supabase
      .from("valves")
      .select("plot_id")
      .eq("id", valve_id)
      .single();

    if (valve) {
      await supabase.from("alerts").insert({
        plot_id: valve.plot_id,
        type: "command_failed",
        message: `Fallo al ejecutar comando de riego (${action}) en válvula ${valve_id}.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Consumidores Kafka
// ---------------------------------------------------------------------------
async function main() {
  console.log("⚙️  AgroPulse Worker — Iniciando...");
  console.log(`   Brokers: ${KAFKA_BROKERS.join(", ")}`);
  console.log(`   Topics: ${TOPIC_READINGS}, ${TOPIC_COMMANDS}`);
  console.log(`   Supabase: ${SUPABASE_URL}`);

  const kafka = new Kafka({
    clientId: "agropulse-worker",
    brokers: KAFKA_BROKERS,
    retry: {
      initialRetryTime: 1000,
      retries: 10,
    },
  });

  // --- Consumidor de lecturas de sensores ---
  const readingsConsumer = kafka.consumer({
    groupId: "agropulse-readings-group",
  });

  let readingsConnected = false;
  while (!readingsConnected) {
    try {
      await readingsConsumer.connect();
      readingsConnected = true;
    } catch (err) {
      console.log("⏳ Esperando broker para readings consumer...");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  await readingsConsumer.subscribe({
    topic: TOPIC_READINGS,
    fromBeginning: false,
  });

  await readingsConsumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const reading = JSON.parse(message.value.toString());

        // Persistir lectura en Supabase
        const { error } = await supabase.from("readings").insert({
          station_id: reading.station_id,
          moisture_pct: reading.moisture_pct,
          temperature_c: reading.temperature_c,
          measured_at: reading.measured_at,
        });

        if (error) {
          console.error("❌ Error insertando lectura:", error.message);
          return;
        }

        // Evaluar umbrales para alertas
        const thresholds = await getThresholds(reading.station_id);
        if (thresholds) {
          await evaluateAlert(reading, thresholds);
        }

        console.log(
          `💧 Lectura: estación=${reading.station_id.slice(0, 8)}... humedad=${reading.moisture_pct}% temp=${reading.temperature_c}°C`
        );
      } catch (err) {
        console.error("❌ Error procesando lectura:", err.message);
      }
    },
  });

  console.log("✅ Readings consumer conectado y escuchando");

  // --- Consumidor de comandos de riego ---
  const commandsConsumer = kafka.consumer({
    groupId: "agropulse-commands-group",
  });

  let commandsConnected = false;
  while (!commandsConnected) {
    try {
      await commandsConsumer.connect();
      commandsConnected = true;
    } catch (err) {
      console.log("⏳ Esperando broker para commands consumer...");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  await commandsConsumer.subscribe({
    topic: TOPIC_COMMANDS,
    fromBeginning: false,
  });

  await commandsConsumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const commandData = JSON.parse(message.value.toString());
        console.log(
          `🔧 Procesando comando de riego: ${commandData.command_id}`
        );
        await processIrrigationCommand(commandData);
      } catch (err) {
        console.error("❌ Error procesando comando:", err.message);
      }
    },
  });

  console.log("✅ Commands consumer conectado y escuchando");

  // --- Polling de comandos pendientes (fallback) ---
  // Además de Kafka, verifica periódicamente si hay comandos pendientes
  // que no se publicaron en el topic (e.g., insertados directamente via UI).
  setInterval(async () => {
    try {
      const { data: pendingCommands, error } = await supabase
        .from("irrigation_commands")
        .select("id, valve_id, action, duration_min, user_id")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(10);

      if (error) {
        console.error("❌ Error consultando comandos pendientes:", error.message);
        return;
      }

      for (const cmd of pendingCommands || []) {
        console.log(`🔄 Procesando comando pendiente (polling): ${cmd.id}`);
        await processIrrigationCommand({
          command_id: cmd.id,
          valve_id: cmd.valve_id,
          action: cmd.action,
          duration_min: cmd.duration_min,
          user_id: cmd.user_id,
        });
      }
    } catch (err) {
      console.error("❌ Error en polling de comandos:", err.message);
    }
  }, 5000); // Polling cada 5 segundos
}

main().catch((err) => {
  console.error("💥 Error fatal del worker:", err);
  process.exit(1);
});
