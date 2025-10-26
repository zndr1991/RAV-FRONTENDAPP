import React, { useState } from 'react';
import './LoginPage.css';
import { API_BASE_URL } from './config';

function LoginPage({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
  const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password })
      });
      const data = await response.json();
      if (data.ok) {
        // Guarda el usuario como objeto completo
        const userObj = { username: data.username, role: data.role };
        localStorage.setItem('usuario', JSON.stringify(userObj));
        onLogin(userObj);
      } else {
        setError(data.mensaje || 'Usuario o contraseña incorrectos');
      }
    } catch (err) {
      setError('Error de conexión con el servidor');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">RAV</div>
          <h1>Bienvenido de nuevo</h1>
          <p>Ingresa tus credenciales para acceder al panel de gestión.</p>
        </div>
        <form className="login-form" onSubmit={handleLogin}>
          <div className="input-group">
            <label htmlFor="usuario">Usuario</label>
            <input
              id="usuario"
              className="input-field"
              type="text"
              placeholder="Tu usuario corporativo"
              value={usuario}
              onChange={e => setUsuario(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              className="input-field"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="login-actions">
            {error && <div className="login-error">{error}</div>}
            <button className="login-button" type="submit">
              Acceder
            </button>
          </div>
        </form>
        <div className="login-meta">¿Problemas para entrar? Contacta a soporte interno.</div>
      </div>
    </div>
  );
}

export default LoginPage;