import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './UserManagement.css';
import { API_BASE_URL } from './config';

const api = axios.create({ baseURL: API_BASE_URL });

const ROLES = [
  'Supervisor',
  'Codificar',
  'Seguimientos',
  'Facturacion',
  'Cancelaciones',
  'Captura',
  'Chofer'
];

function UsuariosPage() {
  const [usuarios, setUsuarios] = useState([]);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [editId, setEditId] = useState(null);
  const [editRol, setEditRol] = useState('');
  const [editPasswordActual, setEditPasswordActual] = useState('');
  const [editPasswordNueva, setEditPasswordNueva] = useState('');
  const [saving, setSaving] = useState(false);

  const rolOptions = useMemo(() => ROLES, []);

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const cargarUsuarios = async () => {
    try {
  const response = await api.get('/api/usuarios/listar');
      setUsuarios(response.data);
      setError('');
    } catch (err) {
      setError('No se pudieron cargar los usuarios');
    }
  };

  const handleEdit = (id, rolActual) => {
    setError('');
    setMensaje('');
    setEditId(id);
    setEditRol(rolActual);
    setEditPasswordActual('');
    setEditPasswordNueva('');
  };

  const handleSave = async (id, rolActual) => {
    setMensaje('');
    try {
      setError('');
      const quiereCambiarPassword = Boolean(editPasswordActual || editPasswordNueva);
      if (quiereCambiarPassword && (!editPasswordActual || !editPasswordNueva)) {
        setError('Para cambiar la contraseña llena ambos campos.');
        return;
      }

      setSaving(true);

      if (quiereCambiarPassword) {
  await api.put(`/api/usuarios/${id}/password`, {
          passwordActual: editPasswordActual,
          passwordNueva: editPasswordNueva
        });
      }

      const rolCambio = editRol !== rolActual;
      if (rolCambio) {
  await api.put(`/api/usuarios/${id}`, { rol: editRol });
      }

      if (quiereCambiarPassword && rolCambio) {
        setMensaje('Rol y contraseña actualizados.');
      } else if (quiereCambiarPassword) {
        setMensaje('Contraseña actualizada.');
      } else if (rolCambio) {
        setMensaje('Rol actualizado.');
      } else {
        setMensaje('No se realizaron cambios.');
      }

      setEditId(null);
      setEditRol('');
      setEditPasswordActual('');
      setEditPasswordNueva('');
      cargarUsuarios();
    } catch (err) {
      const mensajeServidor = err.response?.data?.mensaje;
      setError(mensajeServidor || 'No se pudieron guardar los cambios');
    }
    finally {
      setSaving(false);
    }
  };

  return (
    <div className="user-page">
      <section className="user-card">
        <div className="user-card__header">
          <div>
            <h2 className="user-card__title">Gestión de usuarios</h2>
            <p className="user-card__subtitle">
              Consulta los accesos existentes y ajusta el rol de cada persona de forma segura.
            </p>
          </div>
        </div>
        {mensaje && (
          <div className="user-feedback user-feedback--success" role="status">{mensaje}</div>
        )}
        {error && (
          <div className="user-feedback user-feedback--error" role="alert">{error}</div>
        )}
        <div className="user-table-wrapper">
          <table className="user-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Contraseña</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.usuario}</td>
                  <td>
                    {editId === u.id ? (
                      <select
                        className="user-select"
                        value={editRol}
                        onChange={e => setEditRol(e.target.value)}
                      >
                        {rolOptions.map(opcion => (
                          <option key={opcion} value={opcion}>{opcion}</option>
                        ))}
                      </select>
                    ) : (
                      u.rol
                    )}
                  </td>
                  <td>
                    {editId === u.id ? (
                      <div className="user-password-stack">
                        <label className="user-password-label" htmlFor={`password-actual-${u.id}`}>
                          Contraseña anterior
                          <input
                            id={`password-actual-${u.id}`}
                            type="password"
                            className="user-input user-input--compact"
                            placeholder="Ingresa la contraseña actual"
                            value={editPasswordActual}
                            onChange={e => setEditPasswordActual(e.target.value)}
                          />
                        </label>
                        <label className="user-password-label" htmlFor={`password-nueva-${u.id}`}>
                          Nueva contraseña
                          <input
                            id={`password-nueva-${u.id}`}
                            type="password"
                            className="user-input user-input--compact"
                            placeholder="Define la nueva contraseña"
                            value={editPasswordNueva}
                            onChange={e => setEditPasswordNueva(e.target.value)}
                          />
                        </label>
                      </div>
                    ) : (
                      <span className="user-password-placeholder">••••••••</span>
                    )}
                  </td>
                  <td>
                    {editId === u.id ? (
                      <div className="user-inline-actions">
                        <button
                          type="button"
                          className="user-button"
                          onClick={() => handleSave(u.id, u.rol)}
                          disabled={saving}
                        >
                          {saving ? 'Guardando...' : 'Guardar'}
                        </button>
                        <button
                          type="button"
                          className="user-button user-button--ghost"
                          onClick={() => {
                            setEditId(null);
                            setEditRol('');
                            setEditPasswordActual('');
                            setEditPasswordNueva('');
                            setError('');
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="user-button user-button--ghost"
                        onClick={() => handleEdit(u.id, u.rol)}
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default UsuariosPage;