require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 5500;
const HOST = process.env.HOST || "0.0.0.0";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "cambia_esto_en_produccion",
  resave: false,
  saveUninitialized: true
}));

app.use(express.static(path.join(__dirname)));

// ── Rutas HTML ──────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/caracteristicas", (req, res) => {
  res.sendFile(path.join(__dirname, "Caracteristicas.html"));
});

app.get("/precios", (req, res) => {
  res.sendFile(path.join(__dirname, "Precios.html"));
});

app.get("/funcionamiento", (req, res) => {
  res.sendFile(path.join(__dirname, "Funcionamiento.html"));
});

app.get("/dashboard", (req, res) => {
  if (req.session.user) {
    res.sendFile(path.join(__dirname, "DashboardMiguel.html"));
  } else {
    res.redirect("/");
  }
});

// ── Auth ────────────────────────────────────────────────────────────────────

app.post("/login", async (req, res) => {
  const { user, pass } = req.body;

  const { data, error } = await supabase
    .from("usuarios")
    .select("username, password_hash")
    .eq("username", user)
    .single();

  if (error || !data) {
    return res.send("Usuario o contraseña incorrecta <a href='/'>Volver</a>");
  }

  // Comparación directa (sin hash por ahora — ver comentario en schema.sql)
  if (data.password_hash !== pass) {
    return res.send("Usuario o contraseña incorrecta <a href='/'>Volver</a>");
  }

  req.session.user = user;
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ── API pública para el frontend ─────────────────────────────────────────────
// Devuelve solo las credenciales públicas de Supabase (anon key es pública por diseño)
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
});

// ── API de sensores (server-side) ────────────────────────────────────────────
app.get("/api/sensores", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });

  const { data, error } = await supabase
    .from("sensores")
    .select("*")
    .order("ultima_lectura", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/alertas", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });

  const { data, error } = await supabase
    .from("alertas")
    .select("*")
    .eq("resuelta", false)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/clientes", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });

  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .order("mrr", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/lecturas/promedios", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });

  const { data, error } = await supabase
    .from("lecturas")
    .select("temperatura, humedad");

  if (error) return res.status(500).json({ error: error.message });

  const validos = data.filter(r => r.temperatura != null && r.humedad != null);
  const total   = validos.length;

  if (total === 0) return res.json({ avgTemp: null, avgHum: null, total: 0 });

  const avgTemp = validos.reduce((s, r) => s + parseFloat(r.temperatura), 0) / total;
  const avgHum  = validos.reduce((s, r) => s + parseFloat(r.humedad),     0) / total;

  res.json({
    avgTemp: parseFloat(avgTemp.toFixed(1)),
    avgHum:  Math.round(avgHum),
    total
  });
});

app.get("/api/lecturas/ultima", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });

  const { data, error } = await supabase
    .from("lecturas")
    .select("temperatura, humedad, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/lecturas", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });

  const periodo = req.query.periodo || "7d";
  const limites = { "24h": 48, "7d": 100, "30d": 200 };
  const horas   = { "24h": 24, "7d": 168, "30d": 720 };
  const limit   = limites[periodo] || 100;
  const desde   = new Date(Date.now() - (horas[periodo] || 168) * 3600 * 1000).toISOString();

  let query = supabase
    .from("lecturas")
    .select("temperatura, humedad, created_at")
    .order("created_at", { ascending: true })
    .limit(limit);

  // Solo filtrar por fecha si hay datos recientes; si no, devolver los últimos N registros
  const { data: reciente } = await supabase
    .from("lecturas")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (reciente && reciente.length > 0) {
    const ultima = new Date(reciente[0].created_at);
    const desdeRelativo = new Date(ultima.getTime() - (horas[periodo] || 168) * 3600 * 1000).toISOString();
    query = query.gte("created_at", desdeRelativo);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── IA: Análisis e interpretación de datos ───────────────────────────────────
app.post("/api/ia", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });

  const { pregunta } = req.body;
  if (!pregunta) return res.status(400).json({ error: "Pregunta requerida" });

  // Cargar todos los datos
  const { data: lecturas, error } = await supabase
    .from("lecturas")
    .select("temperatura, humedad, created_at")
    .order("created_at", { ascending: true });

  if (error || !lecturas || !lecturas.length) {
    return res.json({ respuesta: "No hay datos disponibles en la base de datos para analizar." });
  }

  const validos = lecturas.filter(r => r.temperatura != null && r.humedad != null);
  const temps   = validos.map(r => parseFloat(r.temperatura));
  const hums    = validos.map(r => parseFloat(r.humedad));
  const total   = validos.length;

  // ── Estadísticas básicas ──
  const avgTemp = parseFloat((temps.reduce((a,b) => a+b, 0) / total).toFixed(1));
  const avgHum  = Math.round(hums.reduce((a,b) => a+b, 0) / total);
  const maxTemp = Math.max(...temps);
  const minTemp = Math.min(...temps);
  const maxHum  = Math.max(...hums);
  const minHum  = Math.min(...hums);

  // ── Tendencia (primer 20% vs último 20%) ──
  const chunk = Math.max(5, Math.floor(total * 0.2));
  const avgTempInicio = temps.slice(0, chunk).reduce((a,b) => a+b, 0) / chunk;
  const avgTempFinal  = temps.slice(-chunk).reduce((a,b) => a+b, 0) / chunk;
  const avgHumInicio  = hums.slice(0, chunk).reduce((a,b) => a+b, 0) / chunk;
  const avgHumFinal   = hums.slice(-chunk).reduce((a,b) => a+b, 0) / chunk;
  const tendenciaTemp = avgTempFinal - avgTempInicio;
  const tendenciaHum  = avgHumFinal - avgHumInicio;

  // ── Anomalías ──
  const TEMP_MAX = 35, TEMP_MIN = 10, HUM_MAX = 85, HUM_MIN = 30;
  const anomTemp = validos.filter(r => parseFloat(r.temperatura) > TEMP_MAX || parseFloat(r.temperatura) < TEMP_MIN);
  const anomHum  = validos.filter(r => parseFloat(r.humedad) > HUM_MAX || parseFloat(r.humedad) < HUM_MIN);
  const picoHum  = validos.filter(r => parseFloat(r.humedad) > 80);

  // ── Fechas ──
  const primera = new Date(lecturas[0].created_at);
  const ultima  = new Date(lecturas[lecturas.length - 1].created_at);
  const fmtFecha = d => d.toLocaleString('es-ES', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const duracionH = Math.round((ultima - primera) / 3600000);

  // ── Variabilidad ──
  const stdTemp = Math.sqrt(temps.map(t => Math.pow(t - avgTemp, 2)).reduce((a,b) => a+b, 0) / total).toFixed(2);
  const stdHum  = Math.sqrt(hums.map(h => Math.pow(h - avgHum, 2)).reduce((a,b) => a+b, 0) / total).toFixed(2);

  // ── Clasificaciones ──
  const estadoTemp = avgTemp > 30 ? "alta" : avgTemp < 15 ? "baja" : "óptima";
  const estadoHum  = avgHum  > 75 ? "elevada" : avgHum < 40 ? "baja" : "adecuada";
  const tendTxtTemp = tendenciaTemp > 0.5 ? `en aumento (+${tendenciaTemp.toFixed(1)}°)` : tendenciaTemp < -0.5 ? `en descenso (${tendenciaTemp.toFixed(1)}°)` : "estable";
  const tendTxtHum  = tendenciaHum  > 2   ? `en aumento (+${tendenciaHum.toFixed(1)}%)` : tendenciaHum  < -2   ? `en descenso (${tendenciaHum.toFixed(1)}%)` : "estable";

  // ── Motor de respuestas ──────────────────────────────────────────────────────
  const q = pregunta.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const contiene = (...words) => words.some(w => q.includes(w));

  let respuesta = "";

  if (contiene("hola", "buenas", "saludos")) {
    respuesta = `¡Hola! Soy el asistente de análisis de GrowAI. Tengo acceso a ${total} lecturas registradas entre el ${fmtFecha(primera)} y el ${fmtFecha(ultima)}. ¿Qué quieres saber sobre los datos de tu finca?`;

  } else if (contiene("resumen", "estado", "general", "como esta", "situacion")) {
    respuesta = `📊 **Resumen general de la finca:**\n\n` +
      `• **Lecturas analizadas:** ${total} registros durante ${duracionH} horas\n` +
      `• **Temperatura:** promedio ${avgTemp}°C (${estadoTemp}), rango ${minTemp}°–${maxTemp}°C, tendencia ${tendTxtTemp}\n` +
      `• **Humedad:** promedio ${avgHum}% (${estadoHum}), rango ${minHum}%–${maxHum}%, tendencia ${tendTxtHum}\n` +
      `• **Anomalías detectadas:** ${anomTemp.length} de temperatura, ${anomHum.length} de humedad\n` +
      `• **Última lectura:** ${fmtFecha(ultima)}`;

  } else if (contiene("temperatura", "temp", "calor", "fria", "frio")) {
    if (contiene("promedio", "media", "media")) {
      respuesta = `🌡️ La temperatura promedio registrada es de **${avgTemp}°C**, calculada sobre ${total} lecturas. Se considera una temperatura ${estadoTemp} para cultivo.`;
    } else if (contiene("maxim", "mayor", "alta", "pico")) {
      respuesta = `🌡️ La temperatura **máxima** registrada fue de **${maxTemp}°C**. El valor mínimo fue ${minTemp}°C, lo que da un rango de variación de ${(maxTemp - minTemp).toFixed(1)}°C.`;
    } else if (contiene("minim", "menor", "baja")) {
      respuesta = `🌡️ La temperatura **mínima** registrada fue de **${minTemp}°C**. La máxima fue ${maxTemp}°C.`;
    } else if (contiene("tendencia", "evolucion", "sube", "baja", "cambio")) {
      respuesta = `📈 La temperatura está **${tendTxtTemp}**. Al inicio del período la media era ${avgTempInicio.toFixed(1)}°C y al final ${avgTempFinal.toFixed(1)}°C.`;
    } else if (contiene("anomal", "alerta", "problema", "riesgo")) {
      respuesta = anomTemp.length > 0
        ? `⚠️ Se detectaron **${anomTemp.length} lecturas anómalas** de temperatura (fuera del rango ${TEMP_MIN}°–${TEMP_MAX}°C). Esto representa el ${((anomTemp.length/total)*100).toFixed(1)}% de los registros.`
        : `✅ No se detectaron anomalías en la temperatura. Todos los valores están dentro del rango seguro (${TEMP_MIN}°–${TEMP_MAX}°C).`;
    } else {
      respuesta = `🌡️ **Análisis de temperatura:**\n• Promedio: ${avgTemp}°C (${estadoTemp})\n• Máxima: ${maxTemp}°C · Mínima: ${minTemp}°C\n• Tendencia: ${tendTxtTemp}\n• Variabilidad (desv. estándar): ±${stdTemp}°C\n• Anomalías: ${anomTemp.length} lecturas fuera de rango`;
    }

  } else if (contiene("humedad", "agua", "riego", "seco", "humedo")) {
    if (contiene("promedio", "media")) {
      respuesta = `💧 La humedad promedio registrada es de **${avgHum}%**, lo que se considera ${estadoHum} para el cultivo.`;
    } else if (contiene("maxim", "mayor", "alta", "pico")) {
      respuesta = `💧 La humedad **máxima** registrada fue de **${maxHum}%**. ${picoHum.length > 0 ? `Se detectaron ${picoHum.length} lecturas con humedad superior al 80%, lo que podría indicar episodios de riego o lluvia.` : ""}`;
    } else if (contiene("minim", "menor", "baja")) {
      respuesta = `💧 La humedad **mínima** registrada fue de **${minHum}%**. ${minHum < 40 ? "Valores por debajo del 40% pueden generar estrés hídrico en los cultivos." : "El valor mínimo está dentro del rango aceptable."}`;
    } else if (contiene("tendencia", "evolucion", "sube", "baja")) {
      respuesta = `📈 La humedad está **${tendTxtHum}**. Inició con una media de ${avgHumInicio.toFixed(1)}% y finalizó en ${avgHumFinal.toFixed(1)}%.`;
    } else if (contiene("riego", "cuando regar", "necesita agua")) {
      respuesta = avgHum < 50
        ? `💧 Con una humedad promedio del ${avgHum}%, se recomienda **revisar el plan de riego**. Los valores están por debajo del umbral óptimo (50-70%).`
        : `💧 La humedad media del ${avgHum}% se encuentra en rango adecuado. No se detecta necesidad urgente de riego adicional.`;
    } else {
      respuesta = `💧 **Análisis de humedad:**\n• Promedio: ${avgHum}% (${estadoHum})\n• Máxima: ${maxHum}% · Mínima: ${minHum}%\n• Tendencia: ${tendTxtHum}\n• Variabilidad: ±${stdHum}%\n• Picos >80%: ${picoHum.length} lecturas\n• Anomalías: ${anomHum.length} lecturas fuera de rango`;
    }

  } else if (contiene("anomal", "problema", "alerta", "riesgo", "peligro", "error")) {
    const totalAnom = anomTemp.length + anomHum.length;
    if (totalAnom === 0) {
      respuesta = `✅ **Sin anomalías detectadas.** Todos los ${total} registros están dentro de los rangos normales de operación (temperatura ${TEMP_MIN}°–${TEMP_MAX}°C, humedad ${HUM_MIN}%–${HUM_MAX}%).`;
    } else {
      respuesta = `⚠️ **Anomalías detectadas:**\n` +
        (anomTemp.length > 0 ? `• **Temperatura:** ${anomTemp.length} lecturas fuera de rango (${TEMP_MIN}°–${TEMP_MAX}°C) — ${((anomTemp.length/total)*100).toFixed(1)}% de los datos\n` : '') +
        (anomHum.length  > 0 ? `• **Humedad:** ${anomHum.length} lecturas fuera de rango (${HUM_MIN}%–${HUM_MAX}%) — ${((anomHum.length/total)*100).toFixed(1)}% de los datos\n` : '') +
        `\nSe recomienda revisar las condiciones del invernadero en los períodos afectados.`;
    }

  } else if (contiene("tendencia", "evolucion", "cambio", "progreso")) {
    respuesta = `📈 **Análisis de tendencia:**\n` +
      `• Temperatura: ${tendTxtTemp} (inicio ${avgTempInicio.toFixed(1)}°C → fin ${avgTempFinal.toFixed(1)}°C)\n` +
      `• Humedad: ${tendTxtHum} (inicio ${avgHumInicio.toFixed(1)}% → fin ${avgHumFinal.toFixed(1)}%)\n\n` +
      `${Math.abs(tendenciaTemp) < 0.5 && Math.abs(tendenciaHum) < 2 ? "Las condiciones ambientales han sido muy estables durante el período analizado." : "Se observan variaciones significativas que conviene monitorizar."}`;

  } else if (contiene("ultima", "ultimo", "reciente", "ahora", "hoy")) {
    const ult = validos[validos.length - 1];
    respuesta = `🕐 La **última lectura** registrada fue el **${fmtFecha(ultima)}**:\n• Temperatura: ${parseFloat(ult.temperatura).toFixed(1)}°C\n• Humedad: ${parseFloat(ult.humedad).toFixed(1)}%`;

  } else if (contiene("primera", "inicio", "primer", "cuando empezo", "comienzo")) {
    const pri = validos[0];
    respuesta = `📅 La **primera lectura** registrada fue el **${fmtFecha(primera)}**:\n• Temperatura: ${parseFloat(pri.temperatura).toFixed(1)}°C\n• Humedad: ${parseFloat(pri.humedad).toFixed(1)}%\n\nEl sistema lleva **${duracionH} horas** de monitorización activa.`;

  } else if (contiene("cuantos", "total", "registros", "datos", "lecturas")) {
    respuesta = `📊 La base de datos contiene **${total} registros válidos** de temperatura y humedad, recopilados entre el ${fmtFecha(primera)} y el ${fmtFecha(ultima)}, a lo largo de **${duracionH} horas** de monitorización.`;

  } else if (contiene("prediccion", "predice", "futuro", "va a pasar", "pronostico")) {
    const alertaTemp = tendenciaTemp > 1 ? "⚠️ La tendencia alcista de temperatura podría superar el umbral de ${TEMP_MAX}°C si continúa." : "✅ La temperatura no muestra riesgo de superar umbrales críticos a corto plazo.";
    const alertaHum  = tendenciaHum < -5 ? "⚠️ La humedad está descendiendo — considerar riego preventivo." : "✅ La humedad se mantiene en niveles seguros.";
    respuesta = `🤖 **Predicción basada en tendencias actuales:**\n\n${alertaTemp}\n${alertaHum}\n\n_Nota: predicción basada en análisis de tendencia lineal de los últimos registros._`;

  } else if (contiene("recomendacion", "que hago", "consejo", "sugerencia", "accion")) {
    const recs = [];
    if (avgTemp > 28)      recs.push("🌡️ Temperatura elevada — revisar ventilación del invernadero");
    if (avgTemp < 15)      recs.push("🌡️ Temperatura baja — considerar calefacción auxiliar");
    if (avgHum < 45)       recs.push("💧 Humedad baja — aumentar frecuencia de riego");
    if (avgHum > 75)       recs.push("💧 Humedad alta — mejorar ventilación para evitar hongos");
    if (anomHum.length > 5)recs.push("⚠️ Picos de humedad detectados — revisar sistema de riego");
    if (recs.length === 0) recs.push("✅ Las condiciones son óptimas. Mantener el plan de cultivo actual.");
    respuesta = `💡 **Recomendaciones basadas en los datos:**\n\n` + recs.map(r => `• ${r}`).join('\n');

  } else {
    respuesta = `No he entendido bien la pregunta. Puedes preguntarme sobre:\n• Temperatura o humedad (promedio, máximo, mínimo, tendencia)\n• Anomalías o alertas detectadas\n• Resumen general del estado de la finca\n• Última o primera lectura registrada\n• Predicciones y recomendaciones`;
  }

  res.json({ respuesta, meta: { total, avgTemp, avgHum, ultima: fmtFecha(ultima) } });
});

// ── Arranque ─────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`Servidor activo en http://${HOST}:${PORT}`);
});
