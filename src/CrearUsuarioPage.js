import React, { useMemo, useState } from 'react';
import './UserManagement.css';
import { API_BASE_URL } from './config';

const ROLES = [
  'Supervisor',
  'Codificar',
  'Seguimientos',
  'Facturacion',
  'Cancelaciones',
  'Captura',
  'Chofer'
];

function CrearUsuarioPage() {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('Supervisor');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const rolOptions = useMemo(() => ROLES, []);

  const handleCrear = async (e) => {
    e.preventDefault();
    setMensaje('');
    setError('');
    try {
  const res = await fetch(`${API_BASE_URL}/api/usuarios/crear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password, rol })
      });
      const data = await res.json();
      if (data.ok) {
        setMensaje(data.mensaje || 'Usuario creado correctamente');
        setUsuario('');
        setPassword('');
        setRol('Supervisor');
      } else {
        setError(data.mensaje || 'No se pudo crear el usuario');
      }
    } catch (err) {
      setError('Error de conexión con el servidor');
    }
  };

  return (
    <div className="user-page">
      <section className="user-card">
        <div className="user-card__header">
          <div>
            <h2 className="user-card__title">Crear usuario</h2>
            <p className="user-card__subtitle">
              Genera credenciales para tu equipo y asigna el rol adecuado desde un solo lugar.
            </p>
          </div>
        </div>
        <form className="user-form" onSubmit={handleCrear}>
          <div className="user-form__field">
            <label className="user-form__label" htmlFor="nuevo-usuario">Usuario</label>
            <input
              id="nuevo-usuario"
              className="user-input"
              placeholder="Nombre de inicio de sesión"
              value={usuario}
              onChange={e => setUsuario(e.target.value)}
              required
            />
          </div>
          <div className="user-form__field">
            <label className="user-form__label" htmlFor="nuevo-password">Contraseña</label>
            <input
              id="nuevo-password"
              className="user-input"
              type="password"
              placeholder="Contraseña temporal"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="user-form__field">
            <label className="user-form__label" htmlFor="nuevo-rol">Rol</label>
            <select
              id="nuevo-rol"
              className="user-select"
              value={rol}
              onChange={e => setRol(e.target.value)}
            >
              {rolOptions.map(opcion => (
                <option key={opcion} value={opcion}>{opcion}</option>
              ))}
            </select>
          </div>
          <div className="user-actions">
            <button className="user-button" type="submit">Crear usuario</button>
          </div>
        </form>
        {mensaje && (
          <div className="user-feedback user-feedback--success" role="status">{mensaje}</div>
        )}
        {error && (
          <div className="user-feedback user-feedback--error" role="alert">{error}</div>
        )}
      </section>
    </div>
  );
}

export default CrearUsuarioPage;