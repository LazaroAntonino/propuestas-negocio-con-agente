
import React, { useState, useRef, useEffect } from 'react';
import './Chatbot.css';


function Chatbot() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Bienvenido. Soy tu asistente especializado en propuestas de negocio. ¿En qué puedo ayudarte hoy?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = { role: 'user', content: input };
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
        body: JSON.stringify({ message: input }),
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
    } catch {
      setMessages((msgs) => {
        const msgsCopy = [...msgs];
        if (msgsCopy.length && msgsCopy[msgsCopy.length - 1].thinking) {
          msgsCopy.pop();
        }
        return [...msgsCopy, { role: 'assistant', content: 'Error al conectar con el servidor.' }];
      });
    } finally {
      setLoading(false);
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
