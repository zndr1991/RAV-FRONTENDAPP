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
  const [searchMode, setSearchMode] = useState('contains');
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
        const cell = String(val).toLowerCase();
        return searchMode === 'exact'
          ? cell === lower
          : cell.includes(lower);
      })
    );
  }, [permittedRows, searchMode, searchText]);

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

  const aplicarActualizacionSocket = useCallback((payload) => {
    if (!payload || payload.type !== 'estatus_update') return false;
    const { id, field, value } = payload;
    if (!id || !field || !EDITABLE_FIELDS.has(field)) return false;

    let encontrado = false;
    let cambioRealizado = false;
    setBaseDataRaw(prev => {
      if (!Array.isArray(prev) || !prev.length) return prev;
      const siguiente = prev.map(row => {
        if (!row || row.id !== id) return row;
        encontrado = true;
        const nuevoValor = value == null ? '' : String(value);
        if (row[field] === nuevoValor) return row;
        cambioRealizado = true;
        return { ...row, [field]: nuevoValor };
      });
      return cambioRealizado ? siguiente : prev;
    });
    return encontrado;
  }, []);

  useEffect(() => {
    cargarDatos();
    cargarNuevoEstatus();
    const socket = socketIOClient(SOCKET_URL);
    const handleExcelUpdated = (payload) => {
      const manejado = aplicarActualizacionSocket(payload);
      if (!manejado) {
        cargarDatos();
      }
    };
    socket.on('excel_data_updated', handleExcelUpdated);
    socket.on('nuevo_estatus_updated', () => {
      cargarNuevoEstatus();
      cargarDatos();
    });
    return () => {
      socket.off('excel_data_updated', handleExcelUpdated);
      socket.disconnect();
    };
  }, [aplicarActualizacionSocket, cargarDatos, cargarNuevoEstatus]);

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

  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return;

    const visibleColumns = columnDefs.filter(col => (
      col.field && (columnVisibilityLoaded ? columnVisibility[col.field] !== false : true)
    ));

    if (!visibleColumns.length) {
      alert('No hay columnas visibles para imprimir.');
      return;
    }

    if (!Array.isArray(filteredData) || !filteredData.length) {
      alert('No hay datos para imprimir.');
      return;
    }

    const escapeHtml = (raw) => {
      const value = raw == null ? '' : String(raw);
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const headerHtml = visibleColumns
      .map(col => `<th>${escapeHtml(col.headerName || col.field)}</th>`)
      .join('');

    const rowsHtml = filteredData
      .map(row => {
        const cells = visibleColumns
          .map(col => `<td>${escapeHtml(row[col.field])}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Pendientes Foráneo</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
    h1 { font-size: 17px; margin: 0 0 10px 0; }
    table { border-collapse: collapse; width: auto; min-width: 100%; table-layout: auto; }
    th, td {
      border: 1px solid #333;
      padding: 3px 6px;
  font-size: 9.5px;
  min-width: 60px;
      word-break: break-word;
      white-space: normal;
    }
    th { background: #1f2937; color: #fff; text-align: left; }
    tr:nth-child(even) { background: #f3f4f6; }
  </style>
</head>
<body style="margin:12mm;">
  <h1>Pendientes Foráneo</h1>
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) throw new Error('No se pudo crear el documento de impresión.');

      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();

      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    } catch (err) {
      console.error('No se pudo preparar la impresión:', err);
      alert('No se pudo preparar la impresión.');
    }
  }, [columnDefs, columnVisibility, columnVisibilityLoaded, filteredData]);

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
        <select
          value={searchMode}
          onChange={(e) => setSearchMode(e.target.value)}
          style={{ padding: 6, borderRadius: 8, border: '1px solid #d0d5dd' }}
        >
          <option value="contains">Contiene</option>
          <option value="exact">Coincidencia exacta</option>
        </select>
        <button
          type="button"
          onClick={() => setShowColumnList(prev => !prev)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: showColumnList ? '#e0e7ff' : '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
        >
          {showColumnList ? 'Ocultar columnas' : 'Seleccionar columnas'}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fef3c7', cursor: 'pointer', fontWeight: 600 }}
        >
          Imprimir
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
          getRowId={(params) => {
            const data = params?.data || {};
            if (data.id != null) return String(data.id);
            const pedido = data.PEDIDO != null ? String(data.PEDIDO) : '';
            const item = data.ITEM != null ? String(data.ITEM) : '';
            return `${pedido}|||${item}`;
          }}
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
          enterMovesDown={false}
          enterMovesDownAfterEdit={false}
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
