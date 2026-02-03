const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { openai } = require('./openaiClient');

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend en producción
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

// IDs de los Assistants de OpenAI (configúralos en .env)
const MAIN_AGENT_ID = process.env.MAIN_AGENT_ID; // Agente de propuesta
const ANALYTICS_AGENT_ID = process.env.ANALYTICS_AGENT_ID; // Agente analista

// Almacenamos los threads por sesión
const sessionThreads = new Map();

/**
 * Obtener o crear un thread para la sesión
 */
async function getOrCreateThread(sessionId) {
  if (sessionThreads.has(sessionId)) {
    return sessionThreads.get(sessionId);
  }
  
  const thread = await openai.beta.threads.create();
  sessionThreads.set(sessionId, thread.id);
  return thread.id;
}

/**
 * Ejecutar un Assistant y esperar la respuesta
 */
async function runAssistant(threadId, assistantId, message) {
  // Añadir mensaje del usuario al thread
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: message
  });

  // Ejecutar el assistant
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId
  });

  // Esperar a que termine (polling) - sintaxis para openai v6+
  let runStatus = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
  
  while (runStatus.status !== 'completed') {
    if (runStatus.status === 'failed' || runStatus.status === 'cancelled' || runStatus.status === 'expired') {
      throw new Error(`Run ${runStatus.status}: ${runStatus.last_error?.message || 'Unknown error'}`);
    }
    
    // Si requiere acción, manejar (por ahora solo loggear)
    if (runStatus.status === 'requires_action') {
      throw new Error('El assistant requiere acciones que no están implementadas');
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1s
    runStatus = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
  }

  // Obtener la respuesta
  const messages = await openai.beta.threads.messages.list(threadId);
  const lastMessage = messages.data[0];
  
  return lastMessage.content[0]?.text?.value || 'No hay respuesta';
}

/**
 * Ejecutar el agente analista (thread separado, sin historial)
 */
async function runAnalyticsAgent(userMessage, botMessage) {
  if (!ANALYTICS_AGENT_ID) {
    console.warn('ANALYTICS_AGENT_ID no configurado');
    return null;
  }

  try {
    // Crear un thread temporal solo para este análisis
    const thread = await openai.beta.threads.create();
    
    const analysisMessage = `Analiza esta interacción:

MENSAJE DEL USUARIO:
"${userMessage}"

RESPUESTA DEL BOT:
"${botMessage}"`;

    // Añadir mensaje y ejecutar
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: analysisMessage
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ANALYTICS_AGENT_ID
    });

    // Esperar respuesta - sintaxis openai v6+
    let runStatus = await openai.beta.threads.runs.retrieve(run.id, { thread_id: thread.id });
    
    while (runStatus.status !== 'completed') {
      if (runStatus.status === 'failed' || runStatus.status === 'cancelled' || runStatus.status === 'expired') {
        throw new Error(`Analytics run ${runStatus.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(run.id, { thread_id: thread.id });
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const response = messages.data[0].content[0]?.text?.value || '{}';

    // Parsear JSON
    const cleanedResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    return JSON.parse(cleanedResponse);

  } catch (error) {
    console.error('Error en agente analista:', error);
    
    // Devolver objeto por defecto si falla
    return {
      event: 'chatbot_interaction',
      tono: 'neutral',
      resolucion: 'no_resuelta',
      intencion: 'pregunta_general',
      etapa_funnel: 'descubrimiento',
      respuesta_completa: true,
      requiere_seguimiento: false,
      mensaje_usuario: userMessage,
      mensaje_bot: botMessage,
      longitud_mensaje_usuario: userMessage.length,
      longitud_mensaje_bot: botMessage.length,
      timestamp: new Date().toISOString(),
      error: true
    };
  }
}

/**
 * Endpoint principal del chat
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default' } = req.body;
    
    console.log('📩 Mensaje recibido:', message, 'SessionId:', sessionId);
    
    if (!message) {
      return res.status(400).json({ error: 'Falta el mensaje' });
    }

    if (!MAIN_AGENT_ID) {
      return res.status(500).json({ error: 'MAIN_AGENT_ID no configurado en el servidor' });
    }

    // 1. Obtener/crear thread para esta sesión
    const threadId = await getOrCreateThread(sessionId);
    console.log('🧵 Thread ID:', threadId);

    // 2. Ejecutar el agente principal
    const reply = await runAssistant(threadId, MAIN_AGENT_ID, message);
    console.log('🤖 Respuesta del agente:', reply.substring(0, 100) + '...');
    console.log('🔍 Tiene saltos de línea:', reply.includes('\n'), '| Cantidad:', (reply.match(/\n/g) || []).length);

    // 3. Ejecutar el agente analista (no bloquea la respuesta principal)
    let analyticsData = null;
    try {
      analyticsData = await runAnalyticsAgent(message, reply);
      console.log('📊 Analytics:', analyticsData?.intencion);
    } catch (analyticsError) {
      console.error('Error en analytics (no crítico):', analyticsError.message);
    }

    // 4. Responder
    res.json({ 
      reply,
      analytics: analyticsData
    });

  } catch (err) {
    console.error('Error en /api/chat:', err);
    res.status(500).json({ error: 'Error interno del servidor', details: err.message });
  }
});

/**
 * Endpoint para resetear conversación
 */
app.post('/api/chat/reset', async (req, res) => {
  try {
    const { sessionId = 'default' } = req.body;
    
    // Eliminar el thread de la sesión
    if (sessionThreads.has(sessionId)) {
      const threadId = sessionThreads.get(sessionId);
      try {
        await openai.beta.threads.del(threadId);
      } catch (e) {
        console.warn('No se pudo eliminar el thread:', e.message);
      }
      sessionThreads.delete(sessionId);
    }
    
    res.json({ success: true, message: 'Conversación reiniciada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al resetear', details: err.message });
  }
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    mainAgentConfigured: !!MAIN_AGENT_ID,
    analyticsAgentConfigured: !!ANALYTICS_AGENT_ID,
    timestamp: new Date().toISOString() 
  });
});

// Catch-all: servir el frontend para cualquier ruta que no sea API (producción)
if (process.env.NODE_ENV === 'production') {
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server en http://localhost:${PORT}`);
  console.log(`Main Agent ID: ${MAIN_AGENT_ID ? '✓ Configurado' : '✗ No configurado'}`);
  console.log(`Analytics Agent ID: ${ANALYTICS_AGENT_ID ? '✓ Configurado' : '✗ No configurado'}`);
});
