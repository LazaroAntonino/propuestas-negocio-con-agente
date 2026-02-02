
import React, { useState, useRef, useEffect } from 'react';
import './Chatbot.css';

// Generar un sessionId único para esta sesión
const getSessionId = () => {
  let sessionId = sessionStorage.getItem('chatbot_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('chatbot_session_id', sessionId);
  }
  return sessionId;
};

// Función para enviar eventos al dataLayer de GTM
const pushToDataLayer = (analyticsData) => {
  if (typeof window !== 'undefined' && window.dataLayer && analyticsData) {
    window.dataLayer.push(analyticsData);
    console.log('📊 DataLayer push:', analyticsData);
  }
};

function Chatbot() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Bienvenido. Soy tu asistente para resolver dudas sobre la propuesta de negocio. ¿En qué puedo ayudarte?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const sessionId = useRef(getSessionId());

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input;
    const userMsg = { role: 'user', content: userMessage };
    setMessages((msgs) => [...msgs, userMsg]);
    setInput('');
    setLoading(true);

    // Mostrar "pensando" animado
    setMessages((msgs) => [
      ...msgs,
      { role: 'assistant', content: '', thinking: true }
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage,
          sessionId: sessionId.current
        }),
      });
      const data = await res.json();
      
      setMessages((msgs) => {
        // Reemplaza el mensaje "pensando" por la respuesta real
        const msgsCopy = [...msgs];
        if (msgsCopy.length && msgsCopy[msgsCopy.length - 1].thinking) {
          msgsCopy.pop();
        }
        return [...msgsCopy, { role: 'assistant', content: data.reply }];
      });

      // Enviar datos de analytics al dataLayer
      if (data.analytics) {
        pushToDataLayer(data.analytics);
      }

    } catch {
      setMessages((msgs) => {
        const msgsCopy = [...msgs];
        if (msgsCopy.length && msgsCopy[msgsCopy.length - 1].thinking) {
          msgsCopy.pop();
        }
        return [...msgsCopy, { role: 'assistant', content: 'Error al conectar con el servidor.' }];
      });

      // Enviar evento de error al dataLayer
      pushToDataLayer({
        event: 'chatbot_error',
        error_type: 'connection_error',
        mensaje_usuario: userMessage,
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  // Función para resetear la conversación
  const resetConversation = async () => {
    try {
      await fetch('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.current }),
      });
      
      setMessages([
        { role: 'assistant', content: 'Bienvenido. Soy tu asistente para resolver dudas sobre la propuesta de negocio. ¿En qué puedo ayudarte?' }
      ]);

      // Evento de reset al dataLayer
      pushToDataLayer({
        event: 'chatbot_reset',
        sessionId: sessionId.current,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error al resetear:', error);
    }
  };

  return (
    <div className="chatbot-fullscreen">
      {/* Noise texture overlay */}
      <div className="background-noise" aria-hidden="true"></div>
      
      <div className="chatbot-window">
        <header className="chatbot-header">
          <h1 className="chatbot-header-title">Propuestas de Negocio</h1>
          <p className="chatbot-header-subtitle">VML The Cocktail • Asistente</p>
          <button 
            className="chatbot-reset-btn" 
            onClick={resetConversation}
            title="Nueva conversación"
          >
            🔄
          </button>
          <div className="chatbot-header-divider" aria-hidden="true"></div>
        </header>
        <div className="chatbot-messages">
          {messages.map((msg, i) =>
            msg.thinking ? (
              <div key={i} className="chatbot-msg assistant thinking" aria-live="polite">
                <span className="thinking-dots">
                  <span></span><span></span><span></span>
                </span>
              </div>
            ) : (
              <div key={i} className={`chatbot-msg ${msg.role}`}>{msg.content}</div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>
        <form className="chatbot-form" onSubmit={sendMessage}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Escribe tu consulta..."
            disabled={loading}
            autoFocus
            aria-label="Escribe tu consulta"
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? 'Enviando...' : 'Enviar'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Chatbot;
