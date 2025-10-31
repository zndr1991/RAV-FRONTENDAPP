import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { io as socketIOClient } from 'socket.io-client';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { baseColumnDefs, parseFechaPedido, promesaRowClassRules } from './baseDatosColumns';
import './PendientesPages.css';
import { API_BASE_URL, SOCKET_URL } from './config';

ModuleRegistry.registerModules([AllCommunityModule]);

const COLUMN_VISIBILITY_STORAGE_KEY = 'baseDatosColumnVisibility';
const normalizeLocalidad = (value) => (value ?? '').toString().trim().toLowerCase();
const normalizeKeyPart = (value) => (value ?? '').toString().trim().toUpperCase();
const buildPedidoItemKey = (pedido, item) => {
  const pedidoKey = normalizeKeyPart(pedido);
  const itemKey = normalizeKeyPart(item);
  if (!pedidoKey && !itemKey) return '';
  return `${pedidoKey}|||${itemKey}`;
};
const normalizeStatus = (value) => (
  (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
);
const ALLOWED_STATUS = new Set(
  ['Entregado', 'En Procesamiento', 'Facturado', 'Aguardando Confirmacion'].map(normalizeStatus)
);
const EDITABLE_FIELDS = new Set(['ESTATUS_LOCAL', 'ESTATUS_FORANEO', 'ESTATUS2']);

const PendientesForaneoPage = () => {
  const gridRef = useRef(null);
  const revertingRef = useRef(false);
  const [baseDataRaw, setBaseDataRaw] = useState([]);
  const [nuevoEstatusData, setNuevoEstatusData] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [showColumnList, setShowColumnList] = useState(false);

  const usuario = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('usuario') || '{}');
    } catch (err) {
      console.warn('No se pudo leer el usuario desde localStorage:', err);
      return {};
    }
  }, []);
  const role = (usuario.role || '').toString().toLowerCase();
  const puedeEditar = role === 'supervisor' || role === 'seguimientos';

  const columnDefs = useMemo(
    () => baseColumnDefs
      .filter(col => col.field !== 'checked')
      .map(col => {
        if (!col.field) return { ...col };
        const isEditableField = EDITABLE_FIELDS.has(col.field);
        return {
          ...col,
          editable: isEditableField && puedeEditar,
          cellEditor: isEditableField && puedeEditar ? col.cellEditor || 'agTextCellEditor' : col.cellEditor,
        };
      }),
    [puedeEditar]
  );

  const baseColumnFields = useMemo(
    () => columnDefs
      .map(col => col.field)
      .filter(field => field),
    [columnDefs]
  );

  const columnLabels = useMemo(() => {
    const labels = {};
    columnDefs.forEach(col => {
      if (col.field) {
        labels[col.field] = col.headerName || col.field;
      }
    });
    return labels;
  }, [columnDefs]);

  const defaultColumnVisibility = useMemo(() => {
    const defaults = {};
    baseColumnFields.forEach(field => {
      defaults[field] = true;
    });
    return defaults;
  }, [baseColumnFields]);

  const [columnVisibility, setColumnVisibility] = useState({});
  const [columnVisibilityLoaded, setColumnVisibilityLoaded] = useState(false);

  const nuevoEstatusLookup = useMemo(() => {
    const map = new Map();
    nuevoEstatusData.forEach(row => {
      if (!row) return;
      const key = buildPedidoItemKey(row.PEDIDO, row.ITEM);
      if (!key || map.has(key)) return;
      const estatus = row.ESTATUS;
      if (typeof estatus === 'undefined' || estatus === null) return;
      const normalized = typeof estatus === 'string' ? estatus : String(estatus);
      map.set(key, normalized);
    });
    return map;
  }, [nuevoEstatusData]);

  const enrichedRows = useMemo(() => {
    if (!Array.isArray(baseDataRaw) || baseDataRaw.length === 0) return baseDataRaw;
    return baseDataRaw.map(row => {
      if (!row) return row;
      const key = buildPedidoItemKey(row.PEDIDO, row.ITEM);
      if (!key || !nuevoEstatusLookup.has(key)) return row;
      const nuevoValor = nuevoEstatusLookup.get(key);
      if (row.NUEVO_ESTATUS === nuevoValor) return row;
      return { ...row, NUEVO_ESTATUS: nuevoValor };
    });
  }, [baseDataRaw, nuevoEstatusLookup]);

  const permittedRows = useMemo(() => (
    Array.isArray(enrichedRows)
      ? enrichedRows.filter(row => {
        const normalized = normalizeStatus(row.NUEVO_ESTATUS);
        return normalized === '' || ALLOWED_STATUS.has(normalized);
      })
      : []
  ), [enrichedRows]);

  const filteredData = useMemo(() => {
    if (!searchText) return permittedRows;
    const lower = searchText.toLowerCase();
    return permittedRows.filter(row =>
      Object.values(row).some(val => {
        if (val == null) return false;
        return String(val).toLowerCase().includes(lower);
      })
    );
  }, [permittedRows, searchText]);

  const cargarDatos = useCallback(() => {
    fetch(`${API_BASE_URL}/api/basedatos/obtener`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) {
          setBaseDataRaw([]);
          return;
        }
        const foraneos = data
          .filter(row => normalizeLocalidad(row.LOCALIDAD) === 'foraneo')
          .sort((a, b) => parseFechaPedido(b.FECHA_PEDIDO) - parseFechaPedido(a.FECHA_PEDIDO));
        setBaseDataRaw(foraneos);
      })
      .catch(() => setBaseDataRaw([]));
  }, []);

  const cargarNuevoEstatus = useCallback(() => {
    fetch(`${API_BASE_URL}/api/nuevo-estatus/obtener`)
      .then(res => res.json())
      .then(payload => {
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.rows)
            ? payload.rows
            : [];
        setNuevoEstatusData(rows);
      })
      .catch(() => setNuevoEstatusData([]));
  }, []);

  useEffect(() => {
    cargarDatos();
    cargarNuevoEstatus();
    const socket = socketIOClient(SOCKET_URL);
    socket.on('excel_data_updated', cargarDatos);
    socket.on('nuevo_estatus_updated', () => {
      cargarNuevoEstatus();
      cargarDatos();
    });
    return () => {
      socket.disconnect();
    };
  }, [cargarDatos, cargarNuevoEstatus]);

  useEffect(() => {
    const storedRaw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (storedRaw) {
      try {
        const stored = JSON.parse(storedRaw);
        setColumnVisibility({ ...defaultColumnVisibility, ...stored });
        setColumnVisibilityLoaded(true);
        return;
      } catch (err) {
        console.warn('No se pudo leer la visibilidad guardada:', err);
      }
    }
    setColumnVisibility(defaultColumnVisibility);
    setColumnVisibilityLoaded(true);
  }, [defaultColumnVisibility]);

  useEffect(() => {
    if (!columnVisibilityLoaded) return;
    localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility, columnVisibilityLoaded]);

  useEffect(() => {
    if (!columnVisibilityLoaded) return;
    setColumnVisibility(prev => {
      const next = { ...prev };
      let changed = false;
      baseColumnFields.forEach(field => {
        if (typeof next[field] === 'undefined') {
          next[field] = true;
          changed = true;
        }
      });
      Object.keys(next).forEach(field => {
        if (!baseColumnFields.includes(field)) {
          delete next[field];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [baseColumnFields, columnVisibilityLoaded]);

  const handleToggleColumnVisibility = useCallback((field) => {
    if (!columnVisibilityLoaded) return;
    setColumnVisibility(prev => {
      const currentlyVisible = prev[field] !== false;
      return { ...prev, [field]: !currentlyVisible };
    });
  }, [columnVisibilityLoaded]);

  const handleCellEdit = useCallback((params) => {
    if (revertingRef.current) return;
    if (!puedeEditar) return;

    const field = params?.colDef?.field;
    if (!field || !EDITABLE_FIELDS.has(field)) return;

    const rowId = params?.data?.id;
    if (!rowId) {
      revertingRef.current = true;
      params.node.setDataValue(field, params.oldValue ?? '');
      revertingRef.current = false;
      return;
    }

    const oldValue = params.oldValue == null ? '' : String(params.oldValue);
    const newValueRaw = params.newValue == null ? '' : params.newValue;
    const newValue = typeof newValueRaw === 'string' ? newValueRaw : String(newValueRaw);

    if (oldValue === newValue) return;

    fetch(`${API_BASE_URL}/api/basedatos/actualizar-estatus`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rowId, field, value: newValue })
    })
      .then(res => res.json())
      .then(data => {
        if (!data?.ok) {
          throw new Error(data?.mensaje || 'Error al actualizar estatus');
        }
      })
      .catch(err => {
        console.error('No se pudo actualizar el estatus:', err);
        alert('No se pudo guardar el cambio.');
        revertingRef.current = true;
        params.node.setDataValue(field, oldValue);
        revertingRef.current = false;
      });
  }, [puedeEditar]);

  const filteredColumnDefs = useMemo(() => {
    if (!columnVisibilityLoaded) return columnDefs;
    return columnDefs.filter(col => {
      if (!col.field) return true;
      return columnVisibility[col.field] !== false;
    });
  }, [columnDefs, columnVisibility, columnVisibilityLoaded]);

  return (
    <div style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: 16 }}>Pendientes Foráneo</h2>
      <p style={{ marginTop: 0, color: '#6b7280' }}>
        Registros cuya localidad corresponde al equipo foráneo.
      </p>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Buscar en la tabla..."
          style={{ padding: 6, minWidth: 240, borderRadius: 8, border: '1px solid #d0d5dd' }}
        />
        <button
          type="button"
          onClick={() => setShowColumnList(prev => !prev)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: showColumnList ? '#e0e7ff' : '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
        >
          {showColumnList ? 'Ocultar columnas' : 'Seleccionar columnas'}
        </button>
        <span style={{ alignSelf: 'center', fontWeight: 600, color: '#1f2937' }}>
          Total: {filteredData.length}
        </span>
      </div>
      {showColumnList && (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, border: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
          {baseColumnFields.map(field => (
            <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 200, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={columnVisibility[field] !== false}
                onChange={() => handleToggleColumnVisibility(field)}
              />
              <span>{columnLabels[field] || field}</span>
            </label>
          ))}
        </div>
      )}
      <div
        className="ag-theme-alpine"
        style={{ height: 520, width: '100%', borderRadius: 12, overflow: 'hidden' }}
      >
        <AgGridReact
          ref={gridRef}
          columnDefs={filteredColumnDefs}
          rowData={filteredData}
          domLayout="normal"
          rowSelection="none"
          suppressMovableColumns={true}
          enableBrowserTooltips={true}
          enableCellTextSelection={true}
          defaultColDef={{
            resizable: true,
            sortable: true,
            filter: false,
            minWidth: 60,
            editable: false
          }}
          headerHeight={32}
          rowHeight={28}
          singleClickEdit={puedeEditar}
          stopEditingWhenCellsLoseFocus={true}
          onCellValueChanged={handleCellEdit}
          rowClassRules={promesaRowClassRules}
        />
      </div>
    </div>
  );
};

export default PendientesForaneoPage;
