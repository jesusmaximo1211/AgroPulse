/**
 * AgroPulse — Simulador IoT
 *
 * Genera lecturas de sensores (humedad + temperatura) con un random walk
 * y las publica en el topic "sensor-readings" de Redpanda/Kafka.
 *
 * Cada estación genera una lectura cada TICK_INTERVAL_MS (default: 10s).
 *
 * Formato del mensaje:
 * {
 *   station_id: string (UUID),
 *   moisture_pct: number (0-100),
 *   temperature_c: number,
 *   measured_at: string (ISO 8601)
 * }
 */

const { Kafka } = require("kafkajs");

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const TOPIC = process.env.TOPIC_READINGS || "sensor-readings";
const TICK_MS = parseInt(process.env.TICK_INTERVAL_MS || "10000", 10);

// Estaciones fijas del seed (UUIDs idénticos a supabase/seed.sql)
const STATIONS = [
  {
    id: "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    label: "Estación Costa 1-A",
    moisture: 50.0, // valor inicial de humedad
    temperature: 23.0,
  },
  {
    id: "bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    label: "Estación Costa 2-A",
    moisture: 20.0,
    temperature: 30.0,
  },
  {
    id: "cccc3333-cccc-cccc-cccc-cccccccccccc",
    label: "Estación Monte A-1",
    moisture: 80.0,
    temperature: 17.0,
  },
];

// ---------------------------------------------------------------------------
// Random Walk: simula variaciones naturales de humedad y temperatura
// ---------------------------------------------------------------------------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomWalk(current, step, min, max) {
  const delta = (Math.random() - 0.5) * 2 * step;
  return clamp(current + delta, min, max);
}

function generateReading(station) {
  // Actualizar con random walk
  station.moisture = randomWalk(station.moisture, 3.0, 5, 95);
  station.temperature = randomWalk(station.temperature, 0.5, -5, 45);

  return {
    station_id: station.id,
    moisture_pct: parseFloat(station.moisture.toFixed(2)),
    temperature_c: parseFloat(station.temperature.toFixed(2)),
    measured_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Productor Kafka
// ---------------------------------------------------------------------------
async function main() {
  console.log("🌾 AgroPulse Simulator — Iniciando...");
  console.log(`   Brokers: ${KAFKA_BROKERS.join(", ")}`);
  console.log(`   Topic: ${TOPIC}`);
  console.log(`   Intervalo: ${TICK_MS}ms`);
  console.log(`   Estaciones: ${STATIONS.length}`);

  const kafka = new Kafka({
    clientId: "agropulse-simulator",
    brokers: KAFKA_BROKERS,
    retry: {
      initialRetryTime: 1000,
      retries: 10,
    },
  });

  const producer = kafka.producer();

  // Reintentar conexión hasta que Redpanda esté disponible
  let connected = false;
  while (!connected) {
    try {
      await producer.connect();
      connected = true;
      console.log("✅ Conectado al broker Kafka");
    } catch (err) {
      console.log("⏳ Esperando a que Redpanda esté disponible...");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Loop principal: genera lecturas y publica
  let tickCount = 0;
  setInterval(async () => {
    tickCount++;
    const messages = STATIONS.map((station) => {
      const reading = generateReading(station);
      return {
        key: station.id,
        value: JSON.stringify(reading),
      };
    });

    try {
      await producer.send({
        topic: TOPIC,
        messages,
      });
      console.log(
        `📡 Tick #${tickCount} — ${messages.length} lecturas publicadas`
      );
    } catch (err) {
      console.error(`❌ Error publicando tick #${tickCount}:`, err.message);
    }
  }, TICK_MS);
}

main().catch((err) => {
  console.error("💥 Error fatal del simulador:", err);
  process.exit(1);
});
