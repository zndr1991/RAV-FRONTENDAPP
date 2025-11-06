import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { io as socketIOClient } from 'socket.io-client';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import * as XLSX from 'xlsx';
import './PendientesPages.css';
import { baseColumnDefs, parseFechaPedido, promesaRowClassRules } from './baseDatosColumns';
import { API_BASE_URL, SOCKET_URL } from './config';

ModuleRegistry.registerModules([AllCommunityModule]);

const COLUMN_VISIBILITY_STORAGE_KEY = 'baseDatosColumnVisibility';
const normalizeLocalidad = (value) => (value ?? '').toString().trim().toLowerCase();
const normalizeKeyPart = (value) => (value ?? '').toString().trim().toUpperCase();
const buildSiniestroItemKey = (siniestro, item) => {
  const siniestroKey = normalizeKeyPart(siniestro);
  const itemKey = normalizeKeyPart(item);
  if (!siniestroKey && !itemKey) return '';
  return `${siniestroKey}|||${itemKey}`;
};
const buildPedidoItemKey = (pedido, item) => {
  const pedidoKey = normalizeKeyPart(pedido);
  const itemKey = normalizeKeyPart(item);
  if (!pedidoKey && !itemKey) return '';
  return `${pedidoKey}|||${itemKey}`;
};
const extractSiniestro = (row) => row?.SINIESTRO ?? row?.siniestro ?? row?.Siniestro ?? '';
const extractItem = (row) => row?.ITEM ?? row?.item ?? row?.Item ?? '';
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
const ROLE_RESTRICTED_FIELDS = new Set(['ESTATUS_LOCAL', 'ESTATUS_FORANEO', 'ESTATUS2']);
const UNRESTRICTED_EDITABLE_FIELDS = new Set(['LOCALIDAD']);
const CAPTURA_EDITABLE_FIELDS = new Set(['CHOFER']);
const EDITABLE_FIELDS = new Set([
  ...ROLE_RESTRICTED_FIELDS,
  ...UNRESTRICTED_EDITABLE_FIELDS,
  ...CAPTURA_EDITABLE_FIELDS
]);
const SELECTION_FIELD = '__select__';

const applyTextFilter = (rows, text, mode) => {
  if (!text) return rows;
  const lower = text.toLowerCase();
  return rows.filter(row => {
    const values = Object.values(row);
    if (mode === 'not_contains') {
      return values.every(val => {
        if (val == null) return true;
        return !String(val).toLowerCase().includes(lower);
      });
    }
    if (mode === 'exact') {
      return values.some(val => {
        if (val == null) return false;
        return String(val).toLowerCase() === lower;
      });
    }
    return values.some(val => {
      if (val == null) return false;
      return String(val).toLowerCase().includes(lower);
    });
  });
};

const PendientesLocalPage = () => {
  const gridRef = useRef(null);
  const revertingRef = useRef(false);
  const [baseDataRaw, setBaseDataRaw] = useState([]);
  const [nuevoEstatusData, setNuevoEstatusData] = useState([]);
  const [globalDuplicateKeys, setGlobalDuplicateKeys] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [searchMode, setSearchMode] = useState('contains');
  const [secondarySearchText, setSecondarySearchText] = useState('');
  const [secondarySearchMode, setSecondarySearchMode] = useState('contains');
  const [tertiarySearchText, setTertiarySearchText] = useState('');
  const [tertiarySearchMode, setTertiarySearchMode] = useState('contains');
  const [showColumnList, setShowColumnList] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [cellInspector, setCellInspector] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const undoStackRef = useRef([]);
  const pendingUndoRef = useRef(null);
  const suppressHistoryRef = useRef(false);

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

  const inspectorInputRef = useRef(null);
  const inspectorSuppressCommitRef = useRef(false);
  const inspectorFocusTrackerRef = useRef({ field: null, rowKey: null });
  const inspectorStateRef = useRef(null);

  const pushUndoEntry = useCallback((entry) => {
    const stack = undoStackRef.current;
    stack.push(entry);
    while (stack.length > 5) {
      stack.shift();
    }
    setCanUndo(stack.length > 0);
  }, []);

  const restoreUndoEntry = useCallback(() => {
    const entry = pendingUndoRef.current;
    if (!entry) {
      suppressHistoryRef.current = false;
      return;
    }
    const stack = undoStackRef.current;
    stack.push(entry);
    while (stack.length > 5) {
      stack.shift();
    }
    pendingUndoRef.current = null;
    suppressHistoryRef.current = false;
    setCanUndo(stack.length > 0);
  }, []);

  const updateRowValueInState = useCallback((rowId, rowKey, field, rawValue) => {
    if (!field) return;
    const normalizedValue = rawValue == null ? '' : String(rawValue);
    setBaseDataRaw(prev => {
      if (!Array.isArray(prev) || !prev.length) return prev;

      let targetIndex = -1;
      if (rowId != null) {
        const rowIdStr = String(rowId);
        targetIndex = prev.findIndex(row => row && row.id != null && String(row.id) === rowIdStr);
      }

      if (targetIndex < 0 && rowKey) {
        targetIndex = prev.findIndex(row => {
          if (!row) return false;
          return buildPedidoItemKey(row.PEDIDO, row.ITEM) === rowKey;
        });
      }

      if (targetIndex < 0) return prev;

      const currentRow = prev[targetIndex];
      if (!currentRow) return prev;
      const currentRaw = currentRow[field];
      const currentValue = currentRaw == null ? '' : String(currentRaw);
      if (currentValue === normalizedValue) return prev;

      const next = [...prev];
      next[targetIndex] = { ...currentRow, [field]: normalizedValue };
      return next;
    });
  }, []);

  useEffect(() => {
    inspectorStateRef.current = cellInspector;
  }, [cellInspector]);

  const canEditField = useCallback((field) => {
    if (!field) return false;
    if (ROLE_RESTRICTED_FIELDS.has(field)) return puedeEditar;
    if (UNRESTRICTED_EDITABLE_FIELDS.has(field)) return true;
    if (CAPTURA_EDITABLE_FIELDS.has(field)) return true;
    return false;
  }, [puedeEditar]);

  const columnDefs = useMemo(() => {
    const selectionColumn = {
      headerName: '',
      field: SELECTION_FIELD,
      width: 36,
      pinned: 'left',
      lockPinned: true,
      suppressMenu: true,
      sortable: false,
      filter: false,
      resizable: false,
      checkboxSelection: true,
      headerCheckboxSelection: true,
      cellClass: 'selection-checkbox-cell'
    };

    const dataColumns = baseColumnDefs
      .filter(col => col.field !== 'checked')
      .map(col => {
        if (!col.field) return { ...col };
        const fieldName = col.field;
        const isEditableField = EDITABLE_FIELDS.has(fieldName);
        const canEditThisField = canEditField(fieldName);
        return {
          ...col,
          editable: isEditableField && canEditThisField,
          cellEditor: isEditableField && canEditThisField ? col.cellEditor || 'agTextCellEditor' : col.cellEditor,
        };
      });

    return [selectionColumn, ...dataColumns];
  }, [canEditField]);

  const baseColumnFields = useMemo(
    () => columnDefs
      .map(col => col.field)
      .filter(field => field && field !== SELECTION_FIELD),
    [columnDefs]
  );

  const columnLabels = useMemo(() => {
    const labels = {};
    columnDefs.forEach(col => {
      if (col.field && col.field !== SELECTION_FIELD) {
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
      const overlayRaw = nuevoEstatusLookup.get(key);
      const overlay = overlayRaw == null ? '' : String(overlayRaw);
      if (overlay.trim() === '') return row;
      const currentRaw = row.NUEVO_ESTATUS == null ? '' : String(row.NUEVO_ESTATUS);
      if (currentRaw.trim() !== '') return row;
      if (currentRaw === overlay) return row;
      return { ...row, NUEVO_ESTATUS: overlay };
    });
  }, [baseDataRaw, nuevoEstatusLookup]);

  const permittedRows = useMemo(() => (
    Array.isArray(enrichedRows)
      ? enrichedRows.filter(row => {
        const normalizedNuevo = normalizeStatus(row.NUEVO_ESTATUS);
        const normalizedEstatus2 = normalizeStatus(row.ESTATUS2);
        if (normalizedEstatus2 === 'cambio') return true;
        return normalizedNuevo === '' || ALLOWED_STATUS.has(normalizedNuevo);
      })
      : []
  ), [enrichedRows]);

  const filteredData = useMemo(() => {
    const primary = applyTextFilter(permittedRows, searchText, searchMode);
    const secondary = applyTextFilter(primary, secondarySearchText, secondarySearchMode);
    return applyTextFilter(secondary, tertiarySearchText, tertiarySearchMode);
  }, [permittedRows, searchMode, searchText, secondarySearchMode, secondarySearchText, tertiarySearchMode, tertiarySearchText]);

  const globalDuplicateSet = useMemo(() => {
    const set = new Set();
    globalDuplicateKeys.forEach(key => {
      if (key) set.add(key);
    });
    return set;
  }, [globalDuplicateKeys]);

  const localDuplicateSet = useMemo(() => {
    if (!Array.isArray(baseDataRaw) || baseDataRaw.length === 0) return new Set();
    const counts = new Map();
    baseDataRaw.forEach(row => {
      const key = buildSiniestroItemKey(extractSiniestro(row), extractItem(row));
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicates = new Set();
    counts.forEach((count, key) => {
      if (count > 1) duplicates.add(key);
    });
    return duplicates;
  }, [baseDataRaw]);

  const combinedDuplicateSet = useMemo(() => {
    const union = new Set();
    globalDuplicateSet.forEach(key => union.add(key));
    localDuplicateSet.forEach(key => union.add(key));
    return union;
  }, [globalDuplicateSet, localDuplicateSet]);

  const getRowClass = useCallback((params) => {
    const data = params?.data;
    if (!data) return '';
    const key = buildSiniestroItemKey(extractSiniestro(data), extractItem(data));
    if (key && combinedDuplicateSet.has(key)) {
      return 'row-texto-rojo';
    }
    return '';
  }, [combinedDuplicateSet]);

  const cargarDatos = useCallback(() => {
    fetch(`${API_BASE_URL}/api/basedatos/obtener`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) {
          setBaseDataRaw([]);
          setGlobalDuplicateKeys([]);
          return;
        }
        const counts = new Map();
        data.forEach(row => {
          const key = buildSiniestroItemKey(extractSiniestro(row), extractItem(row));
          if (!key) return;
          counts.set(key, (counts.get(key) || 0) + 1);
        });
        const duplicates = [];
        counts.forEach((count, key) => {
          if (count > 1) duplicates.push(key);
        });
        setGlobalDuplicateKeys(duplicates);
        const locales = data
          .filter(row => normalizeLocalidad(row.LOCALIDAD) === 'local')
          .sort((a, b) => parseFechaPedido(b.FECHA_PEDIDO) - parseFechaPedido(a.FECHA_PEDIDO));
        setBaseDataRaw(locales);
      })
      .catch(() => {
        setBaseDataRaw([]);
        setGlobalDuplicateKeys([]);
      });
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
    if (!payload) return false;
    const { type, id, field, value } = payload;
    if (!id || !field) return false;

    const isEstatusPayload = type === 'estatus_update' && EDITABLE_FIELDS.has(field);
    const isCapturaPayload = type === 'captura_cell_update' && CAPTURA_EDITABLE_FIELDS.has(field);
    if (!isEstatusPayload && !isCapturaPayload) return false;

    let encontrado = false;
    setBaseDataRaw(prev => {
      if (!Array.isArray(prev) || !prev.length) return prev;
      const targetIndex = prev.findIndex(row => row && row.id != null && String(row.id) === String(id));
      if (targetIndex < 0) return prev;
      encontrado = true;
      const currentRow = prev[targetIndex];
      if (!currentRow) return prev;
      const nuevoValor = value == null ? '' : String(value);
      const currentRaw = currentRow[field];
      const currentValor = currentRaw == null ? '' : String(currentRaw);
      if (currentValor === nuevoValor) return prev;
      const siguiente = [...prev];
      siguiente[targetIndex] = { ...currentRow, [field]: nuevoValor };
      return siguiente;
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

  const handleSelectionChanged = useCallback(() => {
    if (!gridRef.current) return;
    const selectedRows = gridRef.current.api.getSelectedRows();
    setSelectedCount(selectedRows.length);
  }, []);

  const handleCopySelectedRows = useCallback(async () => {
    if (!gridRef.current) return;
    const api = gridRef.current.api;
    const selectedRows = api.getSelectedRows();
    if (!selectedRows.length) {
      alert('Selecciona al menos un renglón para copiar.');
      return;
    }

    const visibleColumns = columnDefs.filter(col => (
      col.field &&
      col.field !== SELECTION_FIELD &&
      (columnVisibilityLoaded ? columnVisibility[col.field] !== false : true)
    ));

    if (!visibleColumns.length) {
      alert('No hay columnas visibles para copiar.');
      return;
    }

    const headers = visibleColumns.map(col => col.headerName || col.field);
    const formattingRow = headers.map(() => '---------------');

    const escapeHtml = (raw) => {
      const value = raw == null ? '' : String(raw);
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };

    const headerHtml = headers
      .map(label => `<th style="border:1px solid #9ca3af;padding:6px 8px;background:#1f2937;color:#ffffff;font-weight:600;">${escapeHtml(label)}</th>`)
      .join('');

    const rowsHtml = selectedRows.map(row => {
      const cells = visibleColumns
        .map(col => `<td style="border:1px solid #d1d5db;padding:6px 8px;">${escapeHtml(row[col.field])}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const htmlTable = `<!DOCTYPE html><html><body><table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial, sans-serif;font-size:13px;"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;

    const plainRows = selectedRows.map(row => (
      visibleColumns
        .map(col => {
          const raw = row[col.field];
          return raw == null ? '' : String(raw);
        })
        .join(' | ')
    ));
    const plainText = [headers.join(' | '), formattingRow.join(' | '), ...plainRows].join('\n');

    let clipboardSucceeded = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.write) {
      try {
        const blobHtml = new Blob([htmlTable], { type: 'text/html' });
        const blobText = new Blob([plainText], { type: 'text/plain' });
        const clipboardItem = new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText
        });
        await navigator.clipboard.write([clipboardItem]);
        clipboardSucceeded = true;
      } catch (err) {
        try {
          await navigator.clipboard.writeText(plainText);
          clipboardSucceeded = true;
        } catch (errText) {
          console.warn('No se pudo copiar formato enriquecido:', err, errText);
        }
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(plainText);
        clipboardSucceeded = true;
      } catch (err) {
        console.warn('No se pudo copiar texto plano:', err);
      }
    }

    if (!clipboardSucceeded) {
      api.copySelectedRowsToClipboard({
        processCellCallback: ({ value }) => (value == null ? '' : String(value)),
        columnKeys: visibleColumns.map(col => col.field)
      });
      clipboardSucceeded = true;
    }
  }, [columnDefs, columnVisibility, columnVisibilityLoaded]);

  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return;

    const visibleColumns = columnDefs.filter(col => (
      col.field && col.field !== SELECTION_FIELD && (columnVisibilityLoaded ? columnVisibility[col.field] !== false : true)
    ));

    if (!visibleColumns.length) {
      alert('No hay columnas visibles para imprimir.');
      return;
    }

    const api = gridRef.current?.api;
    if (!api) {
      alert('No se pudo preparar la impresión.');
      return;
    }

    const selectedRows = api.getSelectedRows();
    if (!Array.isArray(selectedRows) || !selectedRows.length) {
      alert('Selecciona al menos un renglón para imprimir.');
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

    const rowsHtml = selectedRows
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
  <title>Pendientes Local</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
    h1 { font-size: 17px; margin: 0 0 10px 0; }
    table { border-collapse: collapse; width: auto; min-width: 100%; table-layout: auto; }
    thead { display: table-header-group; }
    tbody { display: table-row-group; }
    tbody tr { page-break-inside: avoid; }
    th, td {
      border: 1px solid #333;
      padding: 3px 6px;
      font-size: 11px;
      min-width: 60px;
      word-break: break-word;
      white-space: normal;
    }
    th {
      background: #d1d5db;
      color: #111827;
      text-align: left;
      font-weight: 700;
    }
    tr:nth-child(even) { background: #f3f4f6; }
  </style>
</head>
<body style="margin:12mm;">
  <h1>Pendientes Local</h1>
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
  }, [columnDefs, columnVisibility, columnVisibilityLoaded]);

  const updateInspectorForNode = useCallback((node, field, updater) => {
    setCellInspector(prev => {
      if (!prev || prev.rowNode !== node || prev.field !== field) return prev;
      return updater(prev);
    });
  }, []);

  const handleCellEdit = useCallback((params) => {
    if (revertingRef.current) return;

    const skipHistory = suppressHistoryRef.current === true;

    const field = params?.colDef?.field;
    if (!field || (!EDITABLE_FIELDS.has(field) && !CAPTURA_EDITABLE_FIELDS.has(field))) {
      if (skipHistory) restoreUndoEntry();
      return;
    }

    updateInspectorForNode(params.node, field, prev => ({ ...prev, isCommitting: true }));

    const fieldIsRoleRestricted = ROLE_RESTRICTED_FIELDS.has(field);
    const fieldIsUnrestricted = UNRESTRICTED_EDITABLE_FIELDS.has(field);
    const fieldIsCapturaEditable = CAPTURA_EDITABLE_FIELDS.has(field);

    const puedeEditarCampo = fieldIsRoleRestricted
      ? puedeEditar
      : (fieldIsUnrestricted || fieldIsCapturaEditable);

    if (!puedeEditarCampo) {
      revertingRef.current = true;
      params.node.setDataValue(field, params.oldValue ?? '');
      revertingRef.current = false;
      updateInspectorForNode(params.node, field, prev => {
        const revertValue = params.oldValue == null ? '' : String(params.oldValue);
        return { ...prev, value: revertValue, originalValue: revertValue, isDirty: false, isCommitting: false };
      });
      if (skipHistory) restoreUndoEntry();
      return;
    }

    const rowId = params?.data?.id;
    const rowKey = buildPedidoItemKey(params?.data?.PEDIDO, params?.data?.ITEM);
    const numericId = Number(rowId);
    if (!Number.isInteger(numericId)) {
      revertingRef.current = true;
      params.node.setDataValue(field, params.oldValue ?? '');
      revertingRef.current = false;
      updateInspectorForNode(params.node, field, prev => {
        const revertValue = params.oldValue == null ? '' : String(params.oldValue);
        return { ...prev, value: revertValue, originalValue: revertValue, isDirty: false, isCommitting: false };
      });
      if (skipHistory) restoreUndoEntry();
      return;
    }

    const oldValue = params.oldValue == null ? '' : String(params.oldValue);
    const newValueRaw = params.newValue == null ? '' : params.newValue;
    const newValue = typeof newValueRaw === 'string' ? newValueRaw : String(newValueRaw);

    if (oldValue === newValue) {
      updateInspectorForNode(params.node, field, prev => ({ ...prev, value: newValue, originalValue: newValue, isDirty: false, isCommitting: false }));
      if (skipHistory) restoreUndoEntry();
      return;
    }

    updateRowValueInState(numericId, rowKey, field, newValue);

    const endpoint = fieldIsCapturaEditable
      ? { url: `${API_BASE_URL}/api/basedatos/captura/actualizar-celda`, method: 'POST' }
      : { url: `${API_BASE_URL}/api/basedatos/actualizar-estatus`, method: 'PUT' };

    fetch(endpoint.url, {
      method: endpoint.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: numericId, field, value: newValue })
    })
      .then(res => res.json())
      .then(data => {
        if (!data?.ok) {
          throw new Error(data?.mensaje || 'Error al guardar el cambio');
        }
        updateInspectorForNode(params.node, field, prev => {
          const appliedRaw = params.node?.data?.[field];
          const appliedValue = appliedRaw == null ? '' : String(appliedRaw);
          return { ...prev, value: appliedValue, originalValue: appliedValue, isDirty: false, isCommitting: false };
        });
        const appliedRaw = params.node?.data?.[field];
        const appliedValue = appliedRaw == null ? '' : String(appliedRaw);
        updateRowValueInState(numericId, rowKey, field, appliedValue);
        if (!skipHistory) {
          pushUndoEntry({
            rowId: numericId,
            rowNodeId: params.node?.id ?? null,
            rowKey,
            field,
            previousValue: oldValue,
            newValue: appliedValue
          });
        } else {
          pendingUndoRef.current = null;
          setCanUndo(undoStackRef.current.length > 0);
        }
      })
      .catch(err => {
        console.error('No se pudo guardar el cambio:', err);
        alert('No se pudo guardar el cambio.');
        revertingRef.current = true;
        params.node.setDataValue(field, oldValue);
        revertingRef.current = false;
        updateRowValueInState(numericId, rowKey, field, oldValue);
        updateInspectorForNode(params.node, field, prev => ({ ...prev, value: oldValue, originalValue: oldValue, isDirty: false, isCommitting: false }));
        if (skipHistory) {
          restoreUndoEntry();
        }
      })
      .finally(() => {
        updateInspectorForNode(params.node, field, prev => ({ ...prev, isCommitting: false }));
        if (skipHistory) {
          suppressHistoryRef.current = false;
          pendingUndoRef.current = null;
          setCanUndo(undoStackRef.current.length > 0);
        }
      });
  }, [puedeEditar, updateInspectorForNode, pushUndoEntry, restoreUndoEntry, updateRowValueInState]);

  const filteredColumnDefs = useMemo(() => {
    if (!columnVisibilityLoaded) return columnDefs;
    return columnDefs.filter(col => {
      if (!col.field) return true;
      return columnVisibility[col.field] !== false;
    });
  }, [columnDefs, columnVisibility, columnVisibilityLoaded]);

  const updateInspectorFromParams = useCallback((params) => {
    const field = params?.colDef?.field;
    if (!field || field === SELECTION_FIELD) {
      setCellInspector(null);
      return;
    }
    const node = params?.node;
    if (!node) {
      setCellInspector(null);
      return;
    }
    const rowData = params?.data || node.data || {};
    const rawValue = rowData[field];
    const normalizedValue = rawValue == null ? '' : String(rawValue);
    setCellInspector({
      field,
      header: columnLabels[field] || field,
      rowNode: node,
      rowId: rowData.id ?? null,
      value: normalizedValue,
      originalValue: normalizedValue,
      editable: canEditField(field),
      isDirty: false,
      isCommitting: false
    });
  }, [canEditField, columnLabels]);

  const handleCellClicked = useCallback((params) => {
    updateInspectorFromParams(params);
  }, [updateInspectorFromParams]);

  const handleCellFocused = useCallback((params) => {
    if (!params?.column) {
      setCellInspector(null);
      return;
    }
    const field = params.column.getColDef()?.field;
    if (!field) {
      setCellInspector(null);
      return;
    }
    if (field === SELECTION_FIELD) return;
    const rowIndex = params.rowIndex;
    if (typeof rowIndex !== 'number' || rowIndex < 0) {
      setCellInspector(null);
      return;
    }
    const node = params.api?.getDisplayedRowAtIndex(rowIndex);
    if (!node) {
      setCellInspector(null);
      return;
    }
    updateInspectorFromParams({
      colDef: params.column.getColDef(),
      node,
      data: node.data,
      value: node.data?.[field]
    });
  }, [updateInspectorFromParams]);

  const handleInspectorChange = useCallback((event) => {
    const nextValue = event?.target?.value ?? '';
    setCellInspector(prev => {
      if (!prev) return prev;
      if (prev.value === nextValue) return prev;
      return { ...prev, value: nextValue, isDirty: true };
    });
  }, []);

  const commitInspector = useCallback(() => {
    const current = inspectorStateRef.current;
    if (!current || !current.rowNode || !current.field) return;
    if (!current.editable) return;
    const normalizedValue = current.value == null ? '' : String(current.value);
    const previousRaw = current.rowNode.data?.[current.field];
    const previousValue = previousRaw == null ? '' : String(previousRaw);
    if (!current.isDirty && normalizedValue === current.originalValue) return;
    if (normalizedValue === previousValue) {
      setCellInspector(prev => {
        if (!prev || prev.rowNode !== current.rowNode || prev.field !== current.field) return prev;
        return { ...prev, originalValue: normalizedValue, isDirty: false, isCommitting: false };
      });
      return;
    }
    setCellInspector(prev => {
      if (!prev || prev.rowNode !== current.rowNode || prev.field !== current.field) return prev;
      return { ...prev, isCommitting: true };
    });
    current.rowNode.setDataValue(current.field, normalizedValue);
  }, []);

  const handleInspectorBlur = useCallback(() => {
    if (inspectorSuppressCommitRef.current) {
      inspectorSuppressCommitRef.current = false;
      return;
    }
    commitInspector();
  }, [commitInspector]);

  const handleInspectorKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      inspectorSuppressCommitRef.current = true;
      setTimeout(() => {
        inspectorSuppressCommitRef.current = false;
      }, 0);
      setCellInspector(null);
      inspectorFocusTrackerRef.current = { field: null, rowKey: null };
      gridRef.current?.api?.clearFocusedCell();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commitInspector();
    }
  }, [commitInspector]);

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (!stack.length) return;

    if (suppressHistoryRef.current || pendingUndoRef.current) return;

    const entry = stack.pop();
    setCanUndo(stack.length > 0);

    if (!entry) return;

    const api = gridRef.current?.api;
    if (!api) {
      stack.push(entry);
      if (stack.length > 5) {
        stack.shift();
      }
      setCanUndo(stack.length > 0);
      return;
    }

    let targetNode = null;
    if (entry.rowNodeId != null) {
      targetNode = api.getRowNode(entry.rowNodeId);
    }

    if (!targetNode) {
      api.forEachNode(node => {
        if (targetNode) return;
        const dataId = node.data?.id;
        if (dataId != null && entry.rowId != null && String(dataId) === String(entry.rowId)) {
          targetNode = node;
          return;
        }
        if (entry.rowKey) {
          const key = buildPedidoItemKey(node.data?.PEDIDO, node.data?.ITEM);
          if (key && key === entry.rowKey) {
            targetNode = node;
          }
        }
      });
    }

    if (!targetNode) {
      stack.push(entry);
      if (stack.length > 5) {
        stack.shift();
      }
      setCanUndo(stack.length > 0);
      alert('No se encontró el renglón para deshacer el cambio.');
      return;
    }

    pendingUndoRef.current = entry;
    suppressHistoryRef.current = true;
    targetNode.setDataValue(entry.field, entry.previousValue ?? '');
    setCanUndo(stack.length > 0);
  }, []);

  const handleInspectorCancel = useCallback(() => {
    inspectorSuppressCommitRef.current = true;
    setTimeout(() => {
      inspectorSuppressCommitRef.current = false;
    }, 0);
    setCellInspector(null);
    inspectorFocusTrackerRef.current = { field: null, rowKey: null };
    gridRef.current?.api?.clearFocusedCell();
  }, []);

  const handleExportVisibleToExcel = useCallback(() => {
    const api = gridRef.current?.api;
    const columnApi = gridRef.current?.columnApi;
    if (!api) {
      alert('No se pudo acceder a la tabla para exportar.');
      return;
    }

    const flattenDefs = (defs) => {
      const collected = [];
      defs?.forEach(def => {
        if (!def) return;
        if (Array.isArray(def.children) && def.children.length) {
          collected.push(...flattenDefs(def.children));
        } else {
          collected.push(def);
        }
      });
      return collected;
    };

    const columnInstances = columnApi?.getAllColumns?.() || [];
    const columnDescriptors = columnInstances.length
      ? columnInstances.map(column => ({
          column,
          colDef: column.getColDef?.() || {}
        }))
      : flattenDefs(columnDefs).map(colDef => ({ column: null, colDef }));

    const exportableDescriptors = columnDescriptors.filter(({ colDef }) => {
      if (!colDef) return false;
      if (colDef.suppressExport) return false;
      if (colDef.field === SELECTION_FIELD) return false;
      if (colDef.checkboxSelection || colDef.headerCheckboxSelection) return false;
      if (!colDef.field && typeof colDef.valueGetter !== 'function') return false;
      return true;
    });

    if (!exportableDescriptors.length) {
      alert('No hay columnas disponibles para exportar.');
      return;
    }

    const rows = [];
    api.forEachNodeAfterFilterAndSort(node => {
      const row = exportableDescriptors.map(({ column, colDef }) => {
        let rawValue;

        if (typeof colDef.valueGetter === 'function') {
          try {
            rawValue = colDef.valueGetter({
              api,
              columnApi,
              context: api?.context,
              data: node.data,
              node,
              colDef,
              column,
              getValue: (field) => (node?.data ? node.data[field] : undefined)
            });
          } catch (err) {
            console.error('No se pudo obtener el valor calculado:', err);
            rawValue = null;
          }
        } else if (colDef.field) {
          rawValue = node?.data ? node.data[colDef.field] : undefined;
        } else if (column && typeof column.getColId === 'function') {
          rawValue = node?.data ? node.data[column.getColId()] : undefined;
        } else if (colDef.colId) {
          rawValue = node?.data ? node.data[colDef.colId] : undefined;
        } else {
          rawValue = undefined;
        }

        if (rawValue === null || typeof rawValue === 'undefined') return '';
        if (rawValue instanceof Date) return rawValue.toISOString();
        if (typeof rawValue === 'object') return JSON.stringify(rawValue);
        return rawValue;
      });
      rows.push(row);
    });

    if (!rows.length) {
      alert('No hay registros para exportar.');
      return;
    }

    const headerRow = exportableDescriptors.map(({ column, colDef }, index) => {
      const displayName = column && columnApi?.getDisplayNameForColumn?.(column, 'header');
      if (displayName) return displayName;
      if (colDef.headerName) return colDef.headerName;
      if (colDef.field) return colDef.field;
      if (colDef.colId) return colDef.colId;
      if (column && typeof column.getColId === 'function') return column.getColId();
      return `Columna ${index + 1}`;
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pendientes Local');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `pendientes-local-${timestamp}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }, [columnDefs]);

  useEffect(() => {
    if (!cellInspector || !cellInspector.editable) {
      inspectorFocusTrackerRef.current = { field: null, rowKey: null };
      return;
    }
    const field = cellInspector.field;
    const rowNode = cellInspector.rowNode;
    const rowKey = rowNode ? (rowNode.id ?? rowNode?.data?.id ?? null) : null;
    const previous = inspectorFocusTrackerRef.current;
    if (previous.field === field && previous.rowKey === rowKey) return;
    inspectorFocusTrackerRef.current = { field, rowKey };
  }, [cellInspector]);

  useEffect(() => {
    if (!cellInspector || cellInspector.isDirty || cellInspector.isCommitting) return;
    if (!cellInspector.rowNode || !cellInspector.field) return;
    const latestRaw = cellInspector.rowNode.data?.[cellInspector.field];
    const latestValue = latestRaw == null ? '' : String(latestRaw);
    if (cellInspector.value === latestValue && cellInspector.originalValue === latestValue) return;
    setCellInspector(prev => {
      if (!prev || !prev.rowNode || prev.rowNode !== cellInspector.rowNode || prev.field !== cellInspector.field) return prev;
      return { ...prev, value: latestValue, originalValue: latestValue };
    });
  }, [cellInspector, baseDataRaw]);

  const inspectorPedidoValue = cellInspector?.rowNode?.data?.PEDIDO;
  const inspectorPedidoLabel = inspectorPedidoValue == null ? '' : String(inspectorPedidoValue).trim();
  const inspectorSiniestroValue = cellInspector?.rowNode?.data?.SINIESTRO;
  const inspectorSiniestroLabel = inspectorSiniestroValue == null ? '' : String(inspectorSiniestroValue).trim();

  return (
    <div style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: 16 }}>Pendientes Local</h2>
      <p style={{ marginTop: 0, color: '#6b7280' }}>
        Registros cuya localidad corresponde al equipo local.
      </p>
      <section
        style={{
          background: '#f8fafc',
          border: '1px solid #d1d5db',
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>
              {cellInspector?.field ? cellInspector.header : 'Inspector de celda'}
            </div>
            {cellInspector?.field ? (
              <>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  {inspectorPedidoLabel ? `Pedido ${inspectorPedidoLabel}` : 'Pedido sin valor'}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {inspectorSiniestroLabel ? `Siniestro ${inspectorSiniestroLabel}` : 'Siniestro sin valor'}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {cellInspector.editable ? 'Los cambios se guardan al salir del campo o con Ctrl+Enter.' : 'Solo lectura.'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                Selecciona una celda para ver su contenido.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleInspectorCancel}
            disabled={!cellInspector}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #d0d5dd',
              background: cellInspector ? '#f9fafb' : '#f3f4f6',
              cursor: cellInspector ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              color: '#1f2937',
              opacity: cellInspector ? 1 : 0.6
            }}
          >
            Limpiar selección
          </button>
        </div>
        {cellInspector ? (
          cellInspector.editable ? (
            <textarea
              ref={inspectorInputRef}
              value={cellInspector.value}
              onChange={handleInspectorChange}
              onBlur={handleInspectorBlur}
              onKeyDown={handleInspectorKeyDown}
              rows={3}
              placeholder="Escribe el valor..."
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                resize: 'vertical',
                fontSize: 12.5,
                minHeight: 72,
                background: '#ffffff'
              }}
            />
          ) : (
            <div
              style={{
                minHeight: 72,
                borderRadius: 10,
                border: '1px solid #dbeafe',
                background: '#ffffff',
                padding: 12,
                fontSize: 12.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#111827'
              }}
            >
              {cellInspector.value || '(vacío)'}
            </div>
          )
        ) : (
          <div
            style={{
              minHeight: 68,
              borderRadius: 10,
              border: '1px dashed #d1d5db',
              background: '#ffffff',
              padding: 12,
              fontSize: 12.5,
              color: '#6b7280'
            }}
          >
            No hay una celda seleccionada.
          </div>
        )}
        {cellInspector?.editable && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onMouseDown={() => { inspectorSuppressCommitRef.current = true; }}
              onClick={() => {
                inspectorSuppressCommitRef.current = false;
                commitInspector();
              }}
              disabled={cellInspector.isCommitting}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                background: cellInspector.isCommitting ? '#bfdbfe' : '#3b82f6',
                color: '#fff',
                fontWeight: 600,
                cursor: cellInspector.isCommitting ? 'not-allowed' : 'pointer'
              }}
            >
              Guardar cambio
            </button>
          </div>
        )}
      </section>
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
          <option value="not_contains">No contiene</option>
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
        <button
          type="button"
          onClick={handleCopySelectedRows}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#e0f2fe', cursor: 'pointer', fontWeight: 600 }}
        >
          Copiar selección
        </button>
        <button
          type="button"
          onClick={handleExportVisibleToExcel}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid #d0d5dd',
            background: '#fef3c7',
            cursor: 'pointer',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          Exportar vista
        </button>
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Deshacer el último cambio (máximo 5)"
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid #d0d5dd',
            background: canUndo ? '#e0e7ff' : '#f3f4f6',
            cursor: canUndo ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <span style={{ fontSize: 16 }}>↶</span>
          Deshacer
        </button>
        <span style={{ alignSelf: 'center', fontWeight: 600, color: '#1f2937' }}>
          Total: {filteredData.length}
        </span>
        <span style={{ alignSelf: 'center', fontWeight: 600, color: '#2563eb' }}>
          Seleccionadas: {selectedCount}
        </span>
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
        <input
          type="text"
          value={secondarySearchText}
          onChange={(e) => setSecondarySearchText(e.target.value)}
          placeholder="Aplicar segundo filtro..."
          style={{ padding: 6, minWidth: 240, borderRadius: 8, border: '1px solid #d0d5dd' }}
        />
        <select
          value={secondarySearchMode}
          onChange={(e) => setSecondarySearchMode(e.target.value)}
          style={{ padding: 6, borderRadius: 8, border: '1px solid #d0d5dd' }}
        >
          <option value="contains">Contiene</option>
          <option value="exact">Coincidencia exacta</option>
          <option value="not_contains">No contiene</option>
        </select>
        {secondarySearchText && (
          <button
            type="button"
            onClick={() => {
              setSecondarySearchText('');
              setSecondarySearchMode('contains');
            }}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
          >
            Limpiar filtro secundario
          </button>
        )}
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
        <input
          type="text"
          value={tertiarySearchText}
          onChange={(e) => setTertiarySearchText(e.target.value)}
          placeholder="Aplicar tercer filtro..."
          style={{ padding: 6, minWidth: 240, borderRadius: 8, border: '1px solid #d0d5dd' }}
        />
        <select
          value={tertiarySearchMode}
          onChange={(e) => setTertiarySearchMode(e.target.value)}
          style={{ padding: 6, borderRadius: 8, border: '1px solid #d0d5dd' }}
        >
          <option value="contains">Contiene</option>
          <option value="exact">Coincidencia exacta</option>
          <option value="not_contains">No contiene</option>
        </select>
        {tertiarySearchText && (
          <button
            type="button"
            onClick={() => {
              setTertiarySearchText('');
              setTertiarySearchMode('contains');
            }}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
          >
            Limpiar tercer filtro
          </button>
        )}
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
          getRowClass={getRowClass}
          domLayout="normal"
          rowSelection="multiple"
          suppressMovableColumns={true}
          enableBrowserTooltips={true}
          enableCellTextSelection={true}
          suppressRowClickSelection={true}
          rowMultiSelectWithClick={true}
          deltaRowDataMode={true}
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
          singleClickEdit={true}
          stopEditingWhenCellsLoseFocus={true}
          onCellValueChanged={handleCellEdit}
          onSelectionChanged={handleSelectionChanged}
          onCellClicked={handleCellClicked}
          onCellFocused={handleCellFocused}
          rowClassRules={promesaRowClassRules}
        />
      </div>
    </div>
  );
};

export default PendientesLocalPage;
