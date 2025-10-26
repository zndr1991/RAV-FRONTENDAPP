import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import LoginPage from './LoginPage';
import UsuariosPage from './UsuariosPage';
import BaseDatosPage from './BaseDatosPage';
import CodificarPage from './CodificarPage';
import CrearUsuarioPage from './CrearUsuarioPage';
import CapturaPage from './CapturaPage';
import './App.css';

function Menu({ usuario, onCerrarSesion }) {
  const rol = (usuario.role || '').toLowerCase();
  const esSupervisor = rol === 'supervisor';
  const esCaptura = rol === 'captura';
  const esCodificar = rol === 'codificar';
  const navLinkClass = ({ isActive }) => `app-nav__link${isActive ? ' app-nav__link--active' : ''}`;
  return (
    <header className="app-header">
      <div className="app-header__top">
        <div>
          <span className="app-header__badge">Panel de gestión</span>
          <h1 className="app-header__title">Hola, {usuario.username}</h1>
          <p className="app-header__subtitle">
            Administra la operación diaria, los pedidos y a tu equipo desde un panel centralizado.
          </p>
        </div>
        <button className="app-header__logout" onClick={onCerrarSesion}>
          Cerrar sesión
        </button>
      </div>
      <nav className="app-nav">
        {(esSupervisor || esCodificar) && (
          <NavLink to="/codificar" className={navLinkClass}>
            Codificar
          </NavLink>
        )}
        <NavLink to="/basedatos" className={navLinkClass}>
          Base de datos
        </NavLink>
        {(esSupervisor || esCaptura) && (
          <NavLink to="/captura" className={navLinkClass}>
            Captura
          </NavLink>
        )}
        {esSupervisor && (
          <>
            <NavLink to="/usuarios" className={navLinkClass}>
              Gestión de Usuarios
            </NavLink>
            <NavLink to="/crear-usuario" className={navLinkClass}>
              Crear Usuario
            </NavLink>
          </>
        )}
      </nav>
    </header>
  );
}

function App() {
  const [usuario, setUsuario] = useState(() => {
    const user = localStorage.getItem('usuario');
    return user ? JSON.parse(user) : null;
  });

  useEffect(() => {
    if (usuario) {
      localStorage.setItem('usuario', JSON.stringify(usuario));
    } else {
      localStorage.removeItem('usuario');
    }
  }, [usuario]);

  if (!usuario) {
    return <LoginPage onLogin={setUsuario} />;
  }

  const rol = (usuario.role || '').toLowerCase();
  const esSupervisor = rol === 'supervisor';
  const esCaptura = rol === 'captura';

  return (
    <BrowserRouter>
      <div className="app-shell">
        <div className="app-container">
          <Menu usuario={usuario} onCerrarSesion={() => setUsuario(null)} />
          <main className="app-main">
            <div className="app-card">
              <Routes>
                <Route path="/" element={<Navigate to="/basedatos" replace />} />
                <Route path="/basedatos" element={<BaseDatosPage />} />
                {(esSupervisor || esCaptura) && (
                  <Route path="/captura" element={<CapturaPage />} />
                )}
                {esSupervisor && (
                  <Route path="/usuarios" element={<UsuariosPage />} />
                )}
                <Route path="/codificar" element={<CodificarPage />} />
                <Route path="/crear-usuario" element={<CrearUsuarioPage />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
