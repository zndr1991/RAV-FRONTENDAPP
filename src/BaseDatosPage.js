import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io as socketIOClient } from 'socket.io-client';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import * as XLSX from 'xlsx';
import { baseColumnDefs as baseDatosColumnDefs, parseFechaPedido } from './baseDatosColumns';
import { API_BASE_URL, SOCKET_URL } from './config';

ModuleRegistry.registerModules([AllCommunityModule]);

const COLUMN_VISIBILITY_STORAGE_KEY = 'baseDatosColumnVisibility';
const COLUMN_WIDTHS_STORAGE_KEY = 'baseDatosColumnWidths';
const LIVE_UPDATE_DELAY_MS = 500;
const SELF_UPDATE_SUPPRESSION_MS = 1800;

const formatTimestamp = (value) => {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(date);
  } catch (err) {
    console.warn('No se pudo formatear la fecha de actualización:', err);
    return '';
  }
};

const normalizeHeaderKey = (key) => {
  if (key === null || key === undefined) return '';
  return key
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_\s]/g, '')
    .replace(/\s+/g, '_');
};

const normalizeKeyPart = (value) => (value ?? '').toString().trim().toUpperCase();

const buildPedidoItemKey = (pedido, item) => {
  const pedidoKey = normalizeKeyPart(pedido);
  const itemKey = normalizeKeyPart(item);
  if (!pedidoKey && !itemKey) return '';
  return `${pedidoKey}|||${itemKey}`;
};

const ordenesColumnDefs = [
  { headerName: '', field: 'checked', checkboxSelection: true, headerCheckboxSelection: true, width: 30, pinned: 'left' },
  { headerName: 'PEDIDO', field: 'PEDIDO', flex: 1, minWidth: 160 },
  { headerName: 'ORDEN PROVEEDOR', field: 'ORDEN_PROVEEDOR', flex: 1.2, minWidth: 200 }
];

const ALLOWED_LOCALIDADES = ['local', 'foraneo'];
const COMPAQ_OPTIONS = ['GENERADO', 'GENERAR'];
const ESTATUS_EDITABLE_FIELDS = new Set(['NUEVO_ESTATUS', 'ESTATUS2']);
const CAPTURA_EDITABLE_FIELDS = new Set(['CODIGO', 'CHOFER', 'COMPAQ']);

const BaseDatosPage = () => {
  const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
  const role = (usuario.role || '').toString().toLowerCase();
  const esSupervisor = role === 'supervisor';
  const puedeGestionarNuevoEstatus = esSupervisor || role === 'seguimientos';

  const [baseDataRaw, setBaseDataRaw] = useState([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState('contiene');
  const [secondarySearchText, setSecondarySearchText] = useState('');
  const [secondarySearchType, setSecondarySearchType] = useState('contiene');
  const [tertiarySearchText, setTertiarySearchText] = useState('');
  const [tertiarySearchType, setTertiarySearchType] = useState('contiene');
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('baseDatosTab') || 'principal');
  const [nuevoEstatusData, setNuevoEstatusData] = useState([]);
  const [nuevoEstatusLastUpdated, setNuevoEstatusLastUpdated] = useState(null);
  const [nuevoEstatusSelectedCount, setNuevoEstatusSelectedCount] = useState(0);
  const [searchNuevoText, setSearchNuevoText] = useState('');
  const [ordenesData, setOrdenesData] = useState([]);
  const [ordenesSelectedCount, setOrdenesSelectedCount] = useState(0);
  const [searchOrdenText, setSearchOrdenText] = useState('');
  const [ordenesExcelData, setOrdenesExcelData] = useState([]);
  const [ordenesPuedeCargar, setOrdenesPuedeCargar] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const gridRef = useRef();
  const revertingRef = useRef(false);
  const nuevoEstatusGridRef = useRef();
  const ordenesGridRef = useRef();
  const ordenesFileInputRef = useRef();
  const nuevoEstatusFileInputRef = useRef();
  const dialogInputRef = useRef(null);
  const inspectorFocusTrackerRef = useRef({ field: null, rowKey: null });
  const inspectorCommitRef = useRef(false);
  const inspectorSuppressCommitRef = useRef(false);
  const liveUpdateTimersRef = useRef(new Map());
  const selfUpdateTimestampRef = useRef(0);
  const undoStackRef = useRef([]);
  const pendingUndoRef = useRef(null);
  const suppressHistoryRef = useRef(false);
  const [nuevoEstatusExcelData, setNuevoEstatusExcelData] = useState([]);
  const [nuevoEstatusPuedeCargar, setNuevoEstatusPuedeCargar] = useState(false);
  const [showColumnListPrincipal, setShowColumnListPrincipal] = useState(false);
  const [showColumnListNuevo, setShowColumnListNuevo] = useState(false);
  const [isAssigningLocalidades, setIsAssigningLocalidades] = useState(false);
  const [cellEditorDialog, setCellEditorDialog] = useState(null);

  const updateBaseRowValue = useCallback((rowId, field, rawValue, fallbackKey) => {
    if (!field) return;
    const normalizedValue = rawValue == null ? '' : String(rawValue);
    setBaseDataRaw(prev => {
      if (!Array.isArray(prev) || !prev.length) return prev;

      let targetIndex = -1;
      if (rowId != null) {
        const rowIdStr = String(rowId);
        targetIndex = prev.findIndex(row => row && row.id != null && String(row.id) === rowIdStr);
      }

      if (targetIndex < 0 && fallbackKey) {
        targetIndex = prev.findIndex(row => {
          if (!row) return false;
          return buildPedidoItemKey(row.PEDIDO, row.ITEM) === fallbackKey;
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
      setCanUndo(undoStackRef.current.length > 0);
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
  const columnDefs = useMemo(
    () => baseDatosColumnDefs.map(column => {
      if (column.field === 'LOCALIDAD') {
        return {
          ...column,
          editable: true,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: ALLOWED_LOCALIDADES
          }
        };
      }
      if (column.field === 'COMPAQ') {
        return {
          ...column,
          editable: () => esSupervisor,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: COMPAQ_OPTIONS
          }
        };
      }
      if (column.field && ESTATUS_EDITABLE_FIELDS.has(column.field)) {
        return {
          ...column,
          editable: () => puedeGestionarNuevoEstatus,
          cellEditor: column.cellEditor || 'agTextCellEditor'
        };
      }
      if (column.field && CAPTURA_EDITABLE_FIELDS.has(column.field)) {
        return {
          ...column,
          editable: () => esSupervisor,
          cellEditor: column.cellEditor || 'agTextCellEditor'
        };
      }
      return { ...column };
    }),
    [esSupervisor, puedeGestionarNuevoEstatus]
  );
  const canEditField = useCallback((field) => {
    if (!field) return false;
    if (field === 'LOCALIDAD') return true;
    if (ESTATUS_EDITABLE_FIELDS.has(field)) return puedeGestionarNuevoEstatus;
    if (CAPTURA_EDITABLE_FIELDS.has(field)) return esSupervisor;
    return false;
  }, [esSupervisor, puedeGestionarNuevoEstatus]);
  const markSelfUpdate = useCallback(() => {
    selfUpdateTimestampRef.current = Date.now();
  }, []);
  const scheduleLivePersist = useCallback((key, persistFn) => {
    const timers = liveUpdateTimersRef.current;
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing.timeoutId);
    }
    const timeoutId = setTimeout(() => {
      timers.delete(key);
      persistFn().catch(err => {
        console.error('Error al guardar un cambio en vivo:', err);
      });
    }, LIVE_UPDATE_DELAY_MS);
    timers.set(key, { timeoutId, persistFn });
  }, []);
  const cancelLivePersist = useCallback((key) => {
    const timers = liveUpdateTimersRef.current;
    const stored = timers.get(key);
    if (!stored) return;
    clearTimeout(stored.timeoutId);
    timers.delete(key);
  }, []);
  const flushLivePersist = useCallback((key) => {
    const timers = liveUpdateTimersRef.current;
    const stored = timers.get(key);
    if (!stored) return;
    clearTimeout(stored.timeoutId);
    timers.delete(key);
    return stored.persistFn();
  }, []);
  const baseColumnFields = useMemo(
    () => columnDefs
      .map(col => col.field)
      .filter(field => field && field !== 'checked'),
    [columnDefs]
  );
  const columnLabels = useMemo(() => {
    const labels = {};
    columnDefs.forEach(col => {
      if (col.field && col.field !== 'checked') {
        labels[col.field] = col.headerName || col.field;
      }
    });
    return labels;
  }, [columnDefs]);
  const headerLookup = useMemo(() => {
    const map = new Map();
    baseColumnFields.forEach(field => {
      map.set(normalizeHeaderKey(field), field);
    });
    return map;
  }, [baseColumnFields]);
  const defaultColumnVisibility = useMemo(() => {
    const defaults = {};
    baseColumnFields.forEach(field => {
      defaults[field] = true;
    });
    return defaults;
  }, [baseColumnFields]);

  const applySearchFilter = useCallback((rows, text, mode) => {
    if (!text) return rows;
    const query = text.toLowerCase();
    const safeRows = Array.isArray(rows) ? rows : [];
    if (mode === 'no_contiene') {
      return safeRows.filter(row => {
        const values = Object.values(row || {});
        return values.every(val => {
          if (val == null) return true;
          return !String(val).toLowerCase().includes(query);
        });
      });
    }
    if (mode === 'exacta') {
      return safeRows.filter(row => {
        const values = Object.values(row || {});
        return values.some(val => {
          if (val == null) return false;
          return String(val).toLowerCase() === query;
        });
      });
    }
    return safeRows.filter(row => {
      const values = Object.values(row || {});
      return values.some(val => {
        if (val == null) return false;
        return String(val).toLowerCase().includes(query);
      });
    });
  }, []);
  const formattedNuevoEstatusLastUpdated = useMemo(
    () => formatTimestamp(nuevoEstatusLastUpdated),
    [nuevoEstatusLastUpdated]
  );
  const [columnVisibility, setColumnVisibility] = useState({});
  const [columnVisibilityLoaded, setColumnVisibilityLoaded] = useState(false);

  // Build a quick lookup so we can project ESTATUS into the main grid.
  const nuevoEstatusLookup = useMemo(() => {
    const map = new Map();
    nuevoEstatusData.forEach(row => {
      if (!row) return;
      const key = buildPedidoItemKey(row.PEDIDO, row.ITEM);
      if (!key) return;
  const estatus = row.ESTATUS;
  if (typeof estatus === 'undefined' || estatus === null) return;
  if (map.has(key)) return;
  const normalizedEstatus = typeof estatus === 'string' ? estatus : String(estatus);
  map.set(key, normalizedEstatus);
    });
    return map;
  }, [nuevoEstatusData]);

  // Inject the matched ESTATUS value into NUEVO_ESTATUS when we render.
  const principalRowData = useMemo(() => {
    if (!Array.isArray(baseDataRaw) || baseDataRaw.length === 0) return baseDataRaw;
    return baseDataRaw.map(row => {
      if (!row) return row;
      const key = buildPedidoItemKey(row.PEDIDO, row.ITEM);
      if (!key) return row;
      if (!nuevoEstatusLookup.has(key)) return row;
      const overlayRaw = nuevoEstatusLookup.get(key);
      const overlay = overlayRaw == null ? '' : String(overlayRaw);
      if (overlay.trim() === '') return row;
      const currentRaw = row.NUEVO_ESTATUS == null ? '' : String(row.NUEVO_ESTATUS);
      if (currentRaw.trim() !== '') return row;
      if (currentRaw === overlay) return row;
      return { ...row, NUEVO_ESTATUS: overlay };
    });
  }, [baseDataRaw, nuevoEstatusLookup]);

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

  const filteredColumnDefs = useMemo(() => {
    if (!columnVisibilityLoaded) return columnDefs;
    return columnDefs.filter(col => {
      if (!col.field || col.field === 'checked') return true;
      return columnVisibility[col.field] !== false;
    });
  }, [columnDefs, columnVisibility, columnVisibilityLoaded]);

  const getPrincipalRowId = useCallback((params) => {
    const rawId = params?.data?.id;
    if (rawId === null || rawId === undefined) {
      const pedido = params?.data?.PEDIDO;
      const item = params?.data?.ITEM;
      return `principal-${pedido ?? 'sin-id'}-item-${item ?? 'na'}`;
    }
    return `principal-${rawId}`;
  }, []);

  const getNuevoEstatusRowId = useCallback((params) => {
    const rawId = params?.data?.id;
    if (rawId === null || rawId === undefined) {
      const pedido = params?.data?.PEDIDO;
      const item = params?.data?.ITEM;
      return `nuevo-${pedido ?? 'sin-id'}-item-${item ?? 'na'}-${params?.node?.rowIndex ?? 0}`;
    }
    return `nuevo-${rawId}`;
  }, []);

  const getOrdenRowId = useCallback((params) => {
    const rawId = params?.data?.id;
    if (rawId === null || rawId === undefined) {
      const pedido = params?.data?.PEDIDO;
      const orden = params?.data?.ORDEN_PROVEEDOR;
      return `orden-${pedido ?? 'sin-id'}-${orden ?? 'sin-orden'}-${params?.node?.rowIndex ?? 0}`;
    }
    return `orden-${rawId}`;
  }, []);

  const cargarDatos = useCallback(() => {
    fetch(`${API_BASE_URL}/api/basedatos/obtener`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) {
          setBaseDataRaw([]);
          return;
        }
        const sorted = [...data].sort((a, b) => {
          const fechaA = parseFechaPedido(a.FECHA_PEDIDO);
          const fechaB = parseFechaPedido(b.FECHA_PEDIDO);
          return fechaB - fechaA;
        });
        setBaseDataRaw(sorted);
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

        const sorted = [...rows].sort((a, b) => {
          const fechaA = parseFechaPedido(a.FECHA_PEDIDO);
          const fechaB = parseFechaPedido(b.FECHA_PEDIDO);
          return fechaB - fechaA;
        });

        setNuevoEstatusData(sorted);

  const lastUpdatedValue = typeof payload?.lastUpdated === 'string' ? payload.lastUpdated : null;
  setNuevoEstatusLastUpdated(lastUpdatedValue || null);
      })
      .catch(() => {
        setNuevoEstatusData([]);
      });
  }, []);

  const cargarOrdenes = useCallback(() => {
    fetch(`${API_BASE_URL}/api/basedatos/ordenes-proveedor/obtener`)
      .then(res => res.json())
        .then(data => {
          if (!Array.isArray(data)) {
            setOrdenesData([]);
            return;
          }
          setOrdenesData(data);
        })
      .catch(() => setOrdenesData([]));
  }, []);

  useEffect(() => {
    cargarDatos();
    cargarOrdenes();
    cargarNuevoEstatus();
    const refrescar = () => cargarDatos();
    const refrescarOrdenes = () => cargarOrdenes();
    const refrescarNuevoEstatus = () => cargarNuevoEstatus();
    window.addEventListener('refreshBaseDatos', refrescar);
    window.addEventListener('refreshOrdenesProveedor', refrescarOrdenes);
    window.addEventListener('refreshNuevoEstatus', refrescarNuevoEstatus);

    // --- SOCKET.IO ---
    const socket = socketIOClient(SOCKET_URL);
    socket.on('excel_data_updated', () => {
      if (Date.now() - selfUpdateTimestampRef.current < SELF_UPDATE_SUPPRESSION_MS) {
        return;
      }
      cargarDatos();
      cargarOrdenes();
      cargarNuevoEstatus();
    });
    socket.on('nuevo_estatus_updated', (payload) => {
      if (Date.now() - selfUpdateTimestampRef.current < SELF_UPDATE_SUPPRESSION_MS) {
        return;
      }
      if (payload && typeof payload.lastUpdated === 'string') {
        setNuevoEstatusLastUpdated(payload.lastUpdated);
      }
      cargarNuevoEstatus();
    });

    return () => {
      window.removeEventListener('refreshBaseDatos', refrescar);
      window.removeEventListener('refreshOrdenesProveedor', refrescarOrdenes);
      window.removeEventListener('refreshNuevoEstatus', refrescarNuevoEstatus);
      socket.disconnect();
    };
  }, [cargarDatos, cargarOrdenes, cargarNuevoEstatus]);

  useEffect(() => {
    localStorage.setItem('baseDatosTab', activeTab);
  }, [activeTab]);

  const filteredDataMemo = useMemo(() => {
    let result = principalRowData;
    result = applySearchFilter(result, searchText, searchType);
    result = applySearchFilter(result, secondarySearchText, secondarySearchType);
    result = applySearchFilter(result, tertiarySearchText, tertiarySearchType);
    return result;
  }, [principalRowData, searchText, searchType, secondarySearchText, secondarySearchType, tertiarySearchText, tertiarySearchType, applySearchFilter]);

  const filteredNuevoEstatus = useMemo(() => {
    if (!searchNuevoText) return nuevoEstatusData;
    const lower = searchNuevoText.toLowerCase();
    return nuevoEstatusData.filter(row =>
      Object.values(row).some(val => {
        if (typeof val !== 'string' && typeof val !== 'number') return false;
        return String(val).toLowerCase().includes(lower);
      })
    );
  }, [nuevoEstatusData, searchNuevoText]);

  const filteredOrdenes = useMemo(() => {
    if (!searchOrdenText) return ordenesData;
    const lower = searchOrdenText.toLowerCase();
    return ordenesData.filter(row =>
      [row.PEDIDO, row.ORDEN_PROVEEDOR]
        .map(val => (val ? String(val).toLowerCase() : ''))
        .some(cell => cell.includes(lower))
    );
  }, [ordenesData, searchOrdenText]);

  const onSelectionChanged = () => {
    if (gridRef.current) {
      const selectedRows = gridRef.current.api.getSelectedRows();
      setSelectedCount(selectedRows.length);
    }
  };

  const onNuevoEstatusSelectionChanged = () => {
    if (nuevoEstatusGridRef.current) {
      const selectedRows = nuevoEstatusGridRef.current.api.getSelectedRows();
      setNuevoEstatusSelectedCount(selectedRows.length);
    }
  };

  const onOrdenSelectionChanged = () => {
    if (ordenesGridRef.current) {
      const selectedRows = ordenesGridRef.current.api.getSelectedRows();
      setOrdenesSelectedCount(selectedRows.length);
    }
  };

  const processEditableCellChange = useCallback(async ({ field, newValue, oldValue, node, data, liveUpdate = false, onApplied }) => {
    if (!field || !node) return { success: false };

    const esCampoEstatus = ESTATUS_EDITABLE_FIELDS.has(field);
    const requiereSupervisor = CAPTURA_EDITABLE_FIELDS.has(field);
    const rowKey = buildPedidoItemKey(data?.PEDIDO, data?.ITEM);
    const numericIdRaw = data?.id;
    const numericId = Number(numericIdRaw);
    const hasValidId = Number.isInteger(numericId);
    const skipHistory = suppressHistoryRef.current === true;

    const releaseSkip = () => {
      if (!skipHistory) return;
      suppressHistoryRef.current = false;
      pendingUndoRef.current = null;
      setCanUndo(undoStackRef.current.length > 0);
    };

    const normalizeValue = (raw) => {
      if (raw == null) return '';
      return typeof raw === 'string' ? raw : String(raw);
    };

    const previousValue = normalizeValue(oldValue);
    const incomingValue = normalizeValue(newValue);
    const currentGridValue = normalizeValue(node?.data?.[field]);

    const setNodeValue = (value) => {
      const normalized = normalizeValue(value);
      revertingRef.current = true;
      node.setDataValue(field, normalized);
      revertingRef.current = false;
      if (hasValidId || rowKey) {
        updateBaseRowValue(hasValidId ? numericId : null, field, normalized, rowKey);
      }
    };

    const notifyApplied = (value, meta) => {
      onApplied?.(normalizeValue(value), meta);
    };

    const applyGridValue = (value) => {
      setNodeValue(value);
      notifyApplied(value, { persisted: true });
    };

    const recordSuccess = (appliedValue) => {
      const normalizedApplied = normalizeValue(appliedValue);
      if (!skipHistory) {
        if (normalizedApplied !== previousValue) {
          pushUndoEntry({
            rowId: numericId,
            rowNodeId: node?.id ?? null,
            rowKey,
            field,
            previousValue,
            newValue: normalizedApplied
          });
        }
      } else {
        releaseSkip();
      }
    };

    const handleFailure = () => {
      if (!skipHistory) return;
      restoreUndoEntry();
      releaseSkip();
    };

    if ((esCampoEstatus && !puedeGestionarNuevoEstatus) || (requiereSupervisor && !esSupervisor)) {
      setNodeValue(previousValue);
      notifyApplied(previousValue, { persisted: false, reverted: true });
      handleFailure();
      return { success: false };
    }

    if (field !== 'LOCALIDAD' && !esCampoEstatus && !requiereSupervisor) {
      setNodeValue(previousValue);
      notifyApplied(previousValue, { persisted: false, reverted: true });
      handleFailure();
      return { success: false };
    }

    if (!hasValidId) {
      setNodeValue(previousValue);
      notifyApplied(previousValue, { persisted: false, reverted: true });
      handleFailure();
      return { success: false };
    }

    const updateKey = `${numericId}:${field}`;

    if (field === 'LOCALIDAD') {
      const trimmed = incomingValue.trim();
      if (!trimmed) {
        setNodeValue(previousValue);
        notifyApplied(previousValue, { persisted: false, reverted: true });
        handleFailure();
        return { success: false };
      }

      const matchingOption = ALLOWED_LOCALIDADES.find(option => option.toLowerCase() === trimmed.toLowerCase());
      if (!matchingOption) {
        alert('Ingresa "local" o "foraneo".');
        setNodeValue(previousValue);
        notifyApplied(previousValue, { persisted: false, reverted: true });
        handleFailure();
        return { success: false };
      }

      if (previousValue.trim().toLowerCase() === matchingOption.toLowerCase()) {
        cancelLivePersist(updateKey);
        if (currentGridValue !== matchingOption) {
          applyGridValue(matchingOption);
        } else {
          notifyApplied(matchingOption, { persisted: true });
        }
        recordSuccess(matchingOption);
        return { success: true, appliedValue: matchingOption };
      }

      const persistRequest = async () => {
        const response = await fetch(`${API_BASE_URL}/api/basedatos/actualizar-estatus`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: numericId, field, value: matchingOption })
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.mensaje || 'No se pudo actualizar la localidad.');
        }
        markSelfUpdate();
      };

      const fallbackValue = previousValue;
      setNodeValue(matchingOption);

      if (liveUpdate) {
        scheduleLivePersist(updateKey, async () => {
          try {
            await persistRequest();
            notifyApplied(matchingOption, { persisted: true });
            recordSuccess(matchingOption);
          } catch (err) {
            console.error('No se pudo actualizar la localidad:', err);
            alert('No se pudo guardar la localidad.');
            setNodeValue(fallbackValue);
            notifyApplied(fallbackValue, { persisted: false, reverted: true });
            handleFailure();
          }
        });
        return { success: true, appliedValue: matchingOption, deferred: true };
      }

      try {
        cancelLivePersist(updateKey);
        await persistRequest();
        notifyApplied(matchingOption, { persisted: true });
        recordSuccess(matchingOption);
        return { success: true, appliedValue: matchingOption };
      } catch (err) {
        console.error('No se pudo actualizar la localidad:', err);
        alert('No se pudo guardar la localidad.');
        setNodeValue(fallbackValue);
        notifyApplied(fallbackValue, { persisted: false, reverted: true });
        handleFailure();
        return { success: false };
      }
    }

    if (esCampoEstatus) {
      const finalValue = incomingValue.trim();
      if (previousValue === finalValue) {
        cancelLivePersist(updateKey);
        if (currentGridValue !== finalValue) {
          applyGridValue(finalValue);
        } else {
          notifyApplied(finalValue, { persisted: true });
        }
        recordSuccess(finalValue);
        return { success: true, appliedValue: finalValue };
      }

      const persistRequest = async () => {
        const response = await fetch(`${API_BASE_URL}/api/basedatos/actualizar-estatus`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: numericId, field, value: finalValue })
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.mensaje || 'No se pudo actualizar el valor.');
        }
        markSelfUpdate();
      };

      const fallbackValue = previousValue;
      setNodeValue(finalValue);

      if (liveUpdate) {
        scheduleLivePersist(updateKey, async () => {
          try {
            await persistRequest();
            notifyApplied(finalValue, { persisted: true });
            recordSuccess(finalValue);
          } catch (err) {
            console.error('No se pudo actualizar el valor:', err);
            alert('No se pudo guardar el cambio.');
            setNodeValue(fallbackValue);
            notifyApplied(fallbackValue, { persisted: false, reverted: true });
            handleFailure();
          }
        });
        return { success: true, appliedValue: finalValue, deferred: true };
      }

      try {
        cancelLivePersist(updateKey);
        await persistRequest();
        notifyApplied(finalValue, { persisted: true });
        recordSuccess(finalValue);
        return { success: true, appliedValue: finalValue };
      } catch (err) {
        console.error('No se pudo actualizar el valor:', err);
        alert('No se pudo guardar el cambio.');
        setNodeValue(fallbackValue);
        notifyApplied(fallbackValue, { persisted: false, reverted: true });
        handleFailure();
        return { success: false };
      }
    }

    if (requiereSupervisor) {
  const trimmedIncoming = incomingValue.trim();
  const finalValue = field === 'COMPAQ' ? trimmedIncoming.toUpperCase() : trimmedIncoming;
  const previousComparable = field === 'COMPAQ' ? previousValue.trim().toUpperCase() : previousValue;

      if (field === 'COMPAQ') {
        if (!finalValue) {
          setNodeValue(previousValue);
          notifyApplied(previousValue, { persisted: false, reverted: true });
          handleFailure();
          return { success: false };
        }
        if (!COMPAQ_OPTIONS.includes(finalValue)) {
          alert('Selecciona "GENERADO" o "GENERAR".');
          setNodeValue(previousValue);
          notifyApplied(previousValue, { persisted: false, reverted: true });
          handleFailure();
          return { success: false };
        }
      }

      if (previousComparable === finalValue) {
        cancelLivePersist(updateKey);
        if (currentGridValue !== finalValue) {
          applyGridValue(finalValue);
        } else {
          notifyApplied(finalValue, { persisted: true });
        }
        recordSuccess(finalValue);
        return { success: true, appliedValue: finalValue };
      }

      const persistRequest = async () => {
        const response = await fetch(`${API_BASE_URL}/api/basedatos/captura/actualizar-celda`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: numericId, field, value: finalValue })
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.mensaje || 'No se pudo actualizar el valor.');
        }
        markSelfUpdate();
      };

      const fallbackValue = previousValue;
      setNodeValue(finalValue);

      if (liveUpdate) {
        scheduleLivePersist(updateKey, async () => {
          try {
            await persistRequest();
            notifyApplied(finalValue, { persisted: true });
            recordSuccess(finalValue);
          } catch (err) {
            console.error('No se pudo actualizar el valor:', err);
            alert('No se pudo guardar el cambio.');
            setNodeValue(fallbackValue);
            notifyApplied(fallbackValue, { persisted: false, reverted: true });
            handleFailure();
          }
        });
        return { success: true, appliedValue: finalValue, deferred: true };
      }

      try {
        cancelLivePersist(updateKey);
        await persistRequest();
        notifyApplied(finalValue, { persisted: true });
        recordSuccess(finalValue);
        return { success: true, appliedValue: finalValue };
      } catch (err) {
        console.error('No se pudo actualizar el valor:', err);
        alert('No se pudo guardar el cambio.');
        setNodeValue(fallbackValue);
        notifyApplied(fallbackValue, { persisted: false, reverted: true });
        handleFailure();
        return { success: false };
      }
    }

    handleFailure();
    return { success: false };
  }, [esSupervisor, puedeGestionarNuevoEstatus, scheduleLivePersist, cancelLivePersist, markSelfUpdate, updateBaseRowValue, pushUndoEntry, restoreUndoEntry]);

  const handlePrincipalCellEdit = useCallback((params) => {
    if (revertingRef.current) return;

    const field = params?.colDef?.field;
    if (!field) return;

    processEditableCellChange({
      field,
      newValue: params?.newValue,
      oldValue: params?.oldValue,
      node: params?.node,
      data: params?.data,
      onApplied: (appliedValue) => {
        const normalized = appliedValue == null ? '' : String(appliedValue);
        setCellEditorDialog(prev => {
          if (!prev) return prev;
          if (prev.rowNode !== params?.node || prev.field !== field) return prev;
          return {
            ...prev,
            data: params?.node?.data || prev.data,
            value: normalized,
            originalValue: normalized,
            isDirty: false,
            isCommitting: false
          };
        });
      }
    }).catch(err => {
      console.error('Error al procesar el cambio:', err);
    });
  }, [processEditableCellChange]);

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

  const updateInspectorFromParams = useCallback((params) => {
    const field = params?.colDef?.field;
    if (!field) {
      setCellEditorDialog(null);
      return;
    }
    const node = params?.node;
    if (!node) {
      setCellEditorDialog(null);
      return;
    }

    const rowData = params?.data || node.data || {};
    const rawValue = rowData[field];
    const normalizedValue = rawValue == null ? '' : String(rawValue);
    let inspectorValue = normalizedValue;
    if (field === 'LOCALIDAD') {
      const matchingOption = ALLOWED_LOCALIDADES.find(option => option.toLowerCase() === normalizedValue.toLowerCase());
      inspectorValue = matchingOption || normalizedValue.toLowerCase();
    } else if (field === 'COMPAQ') {
      const matchingCompaq = COMPAQ_OPTIONS.find(option => option.toLowerCase() === normalizedValue.toLowerCase());
      inspectorValue = matchingCompaq || '';
    }

    inspectorCommitRef.current = false;
    setCellEditorDialog({
      field,
      header: columnLabels[field] || field,
      rowNode: node,
      data: rowData,
      originalValue: normalizedValue,
      value: inspectorValue,
      isDirty: false,
      isCommitting: false
    });
  }, [columnLabels]);

  const handleCellClicked = useCallback((params) => {
    updateInspectorFromParams(params);
  }, [updateInspectorFromParams]);

  const handleCellFocused = useCallback((params) => {
    if (!params?.column) return;
    const field = params.column.getColDef()?.field;
    if (!field) {
      setCellEditorDialog(null);
      return;
    }
    const rowIndex = params.rowIndex;
    if (typeof rowIndex !== 'number' || rowIndex < 0) {
      setCellEditorDialog(null);
      return;
    }
    const node = params.api?.getDisplayedRowAtIndex(rowIndex);
    if (!node) {
      setCellEditorDialog(null);
      return;
    }
    updateInspectorFromParams({
      colDef: params.column.getColDef(),
      node,
      data: node.data,
      value: node.data?.[field]
    });
  }, [updateInspectorFromParams]);

  const commitInspectorDialog = useCallback((dialog) => {
    if (!dialog || !dialog.rowNode || !dialog.field) return;
    if (!dialog.isDirty || dialog.isCommitting || inspectorCommitRef.current) return;

    const { rowNode, field, value } = dialog;
    const rowData = rowNode.data || {};
    const previousValue = rowData[field];

    inspectorCommitRef.current = true;

    setCellEditorDialog(current => {
      if (!current || current.rowNode !== rowNode || current.field !== field) return current;
      return { ...current, isCommitting: true };
    });

    processEditableCellChange({
      field,
      newValue: value,
      oldValue: previousValue,
      node: rowNode,
      data: rowData,
      onApplied: (appliedValue) => {
        const normalizedApplied = appliedValue == null ? '' : String(appliedValue);
        setCellEditorDialog(current => {
          if (!current || current.rowNode !== rowNode || current.field !== field) return current;
          return {
            ...current,
            data: rowNode.data || current.data,
            value: normalizedApplied,
            originalValue: normalizedApplied,
            isDirty: false,
            isCommitting: false
          };
        });
      }
    })
      .then((result) => {
        if (result?.success === false) {
          setCellEditorDialog(current => {
            if (!current || current.rowNode !== rowNode || current.field !== field) return current;
            const refreshedData = rowNode.data || {};
            const refreshedValue = refreshedData[field] == null ? '' : String(refreshedData[field]);
            return {
              ...current,
              data: refreshedData,
              value: refreshedValue,
              originalValue: refreshedValue,
              isDirty: false,
              isCommitting: false
            };
          });
        }
      })
      .catch((err) => {
        console.error('No se pudo aplicar el cambio desde el inspector:', err);
        setCellEditorDialog(current => {
          if (!current || current.rowNode !== rowNode || current.field !== field) return current;
          const refreshedData = rowNode.data || {};
          const refreshedValue = refreshedData[field] == null ? '' : String(refreshedData[field]);
          return {
            ...current,
            data: refreshedData,
            value: refreshedValue,
            originalValue: refreshedValue,
            isDirty: false,
            isCommitting: false
          };
        });
      })
      .finally(() => {
        inspectorCommitRef.current = false;
        setCellEditorDialog(current => {
          if (!current || current.rowNode !== rowNode || current.field !== field) return current;
          if (!current.isCommitting) return current;
          return { ...current, isCommitting: false };
        });
      });
  }, [processEditableCellChange, inspectorCommitRef]);

  const handleInspectorChange = useCallback((field, nextValue) => {
    setCellEditorDialog(prev => {
      if (!prev || prev.field !== field) return prev;
      if (prev.value === nextValue) return prev;
      return {
        ...prev,
        value: nextValue,
        isDirty: true
      };
    });
  }, []);

  const handleDialogValueChange = useCallback((event) => {
    if (!cellEditorDialog) return;
    const field = cellEditorDialog.field;
    if (!canEditField(field)) return;
    let nextValue = event?.target?.value ?? '';
    if (field === 'COMPAQ') {
      nextValue = nextValue.toString().trim().toUpperCase();
    }

    handleInspectorChange(field, nextValue);

    if (field === 'LOCALIDAD' || field === 'COMPAQ') {
      commitInspectorDialog({
        ...cellEditorDialog,
        value: nextValue,
        isDirty: true,
        isCommitting: false
      });
    }
  }, [cellEditorDialog, handleInspectorChange, canEditField, commitInspectorDialog]);

  const handleDialogBlur = useCallback(() => {
    if (inspectorSuppressCommitRef.current) {
      inspectorSuppressCommitRef.current = false;
      return;
    }
    if (!cellEditorDialog) return;
    if (!canEditField(cellEditorDialog.field)) return;
    commitInspectorDialog(cellEditorDialog);
  }, [cellEditorDialog, canEditField, commitInspectorDialog, inspectorSuppressCommitRef]);

  const handleDialogCancel = useCallback(() => {
    inspectorSuppressCommitRef.current = true;
    setTimeout(() => {
      inspectorSuppressCommitRef.current = false;
    }, 0);
    if (cellEditorDialog?.rowNode && cellEditorDialog.field) {
      const rowData = cellEditorDialog.rowNode.data || {};
      const numericId = Number(rowData?.id);
      if (Number.isInteger(numericId)) {
        const key = `${numericId}:${cellEditorDialog.field}`;
        Promise.resolve(flushLivePersist(key)).catch(err => {
          console.error('No se pudo completar el guardado al cerrar el cuadro:', err);
        });
      }
    }
    gridRef.current?.api?.clearFocusedCell();
    inspectorCommitRef.current = false;
    setCellEditorDialog(null);
  }, [cellEditorDialog, flushLivePersist, inspectorCommitRef, inspectorSuppressCommitRef]);

  const inspectorState = cellEditorDialog;
  const inspectorField = inspectorState?.field ?? null;
  const inspectorHeader = inspectorState?.header ?? '';
  const inspectorValue = inspectorState?.value ?? '';
  const inspectorRowData = inspectorState?.data || null;
  const inspectorRowId = inspectorRowData?.id;
  const inspectorIsEditable = inspectorField
    ? canEditField(inspectorField) && !inspectorState?.isCommitting
    : false;

  useEffect(() => {
    if (!cellEditorDialog || !inspectorIsEditable) return;
    const currentField = cellEditorDialog.field;
    const rowNode = cellEditorDialog.rowNode;
    const rowKey = rowNode ? (rowNode.id ?? rowNode?.data?.id ?? null) : null;
    const previous = inspectorFocusTrackerRef.current;
    if (previous.field === currentField && previous.rowKey === rowKey) {
      return;
    }
    inspectorFocusTrackerRef.current = { field: currentField, rowKey };
  }, [cellEditorDialog, inspectorIsEditable]);

  useEffect(() => {
    if (!inspectorIsEditable) {
      inspectorFocusTrackerRef.current = { field: null, rowKey: null };
      dialogInputRef.current = null;
    }
  }, [inspectorIsEditable]);

  useEffect(() => {
    if (!cellEditorDialog) {
      inspectorFocusTrackerRef.current = { field: null, rowKey: null };
    }
  }, [cellEditorDialog]);

  useEffect(() => {
    if (!inspectorState?.rowNode || !inspectorField) return;
    if (inspectorState.isDirty) return;
    const latestData = inspectorState.rowNode.data || {};
    const rawValue = latestData[inspectorField];
    const normalizedValue = rawValue == null ? '' : String(rawValue);
    let nextValue = normalizedValue;
    if (inspectorField === 'LOCALIDAD') {
      nextValue = ALLOWED_LOCALIDADES.find(option => option.toLowerCase() === normalizedValue.toLowerCase()) || normalizedValue.toLowerCase();
    } else if (inspectorField === 'COMPAQ') {
      nextValue = COMPAQ_OPTIONS.find(option => option.toLowerCase() === normalizedValue.toLowerCase()) || '';
    }
    setCellEditorDialog(prev => {
      if (!prev) return prev;
      if (prev.rowNode !== inspectorState.rowNode || prev.field !== inspectorField) return prev;
      if (prev.value === nextValue) return prev;
      return { ...prev, data: latestData, value: nextValue, originalValue: normalizedValue };
    });
  }, [inspectorState, inspectorField, principalRowData]);

  const flushAllLiveUpdates = useCallback(() => {
    inspectorCommitRef.current = false;
    const timers = liveUpdateTimersRef.current;
    const pending = Array.from(timers.values());
    timers.clear();
    pending.forEach(({ timeoutId, persistFn }) => {
      clearTimeout(timeoutId);
      Promise.resolve(persistFn()).catch(err => {
        console.error('No se pudo completar una actualización pendiente:', err);
      });
    });
  }, [inspectorCommitRef]);

  useEffect(() => {
    return () => {
      flushAllLiveUpdates();
    };
  }, [flushAllLiveUpdates]);

  const handleDialogKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleDialogCancel();
      return;
    }
    if ((event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      if (cellEditorDialog && canEditField(cellEditorDialog.field)) {
        commitInspectorDialog(cellEditorDialog);
      }
    }
  }, [handleDialogCancel, cellEditorDialog, canEditField, commitInspectorDialog]);

  const handleAutoAssignLocalidades = useCallback(async () => {
    if (isAssigningLocalidades) return;
    setIsAssigningLocalidades(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/basedatos/asignar-localidades`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.mensaje || 'No se pudieron asignar las localidades');
      }
      const updated = Number(payload.updated) || 0;
      if (updated > 0) {
        alert(`Se actualizaron ${updated} registros.`);
      } else {
        alert('No se encontraron registros pendientes por asignar.');
      }
      cargarDatos();
    } catch (err) {
      console.error('Error al asignar localidades automáticamente:', err);
      alert('Ocurrió un error al asignar las localidades automáticamente.');
    } finally {
      setIsAssigningLocalidades(false);
    }
  }, [cargarDatos, isAssigningLocalidades]);

  const handleDeleteSelected = async () => {
    if (!esSupervisor) return;
    if (!gridRef.current) return;
    const selectedRows = gridRef.current.api.getSelectedRows();
    if (selectedRows.length === 0) {
      alert('Selecciona al menos un renglón para borrar.');
      return;
    }
    const ids = selectedRows.map(row => row.id);
    try {
  const res = await fetch(`${API_BASE_URL}/api/basedatos/borrar`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (data.ok) {
        cargarDatos();
        setSelectedCount(0);
        gridRef.current.api.deselectAll();
      } else {
        alert(data.mensaje || 'Error al borrar');
      }
    } catch (err) {
      alert('Error de conexión al borrar');
    }
  };

  const handleDeleteNuevoEstatus = async () => {
    if (!esSupervisor) return;
    if (!nuevoEstatusGridRef.current) return;
    const selectedRows = nuevoEstatusGridRef.current.api.getSelectedRows();
    if (selectedRows.length === 0) {
      alert('Selecciona al menos un renglón para borrar.');
      return;
    }
    const ids = selectedRows.map(row => row.id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/nuevo-estatus/borrar`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (data.ok) {
        cargarNuevoEstatus();
        setNuevoEstatusSelectedCount(0);
        nuevoEstatusGridRef.current.api.deselectAll();
      } else {
        alert(data.mensaje || 'Error al borrar');
      }
    } catch (err) {
      alert('Error de conexión al borrar');
    }
  };

  const handleNuevoEstatusFileUpload = (e) => {
    if (!puedeGestionarNuevoEstatus) return;
    const file = e.target.files ? e.target.files[0] : null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      if (!bstr) return;
      const workbook = XLSX.read(bstr, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const mappedRows = rawRows.map(raw => {
        const normalized = {};
        Object.entries(raw).forEach(([key, value]) => {
          const field = headerLookup.get(normalizeHeaderKey(key));
          if (field) {
            normalized[field] = value;
          }
        });
        return normalized;
      }).filter(row => Object.keys(row).length > 0);
      setNuevoEstatusExcelData(mappedRows);
      setNuevoEstatusPuedeCargar(mappedRows.length > 0);
      if (nuevoEstatusFileInputRef.current) {
        nuevoEstatusFileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleCargarNuevoEstatusExcel = async () => {
    if (!puedeGestionarNuevoEstatus) return;
    if (!nuevoEstatusExcelData.length) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/nuevo-estatus/insertar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevoEstatusExcelData)
      });
      const data = await res.json();
      if (data.ok) {
        setNuevoEstatusExcelData([]);
        setNuevoEstatusPuedeCargar(false);
        if (nuevoEstatusFileInputRef.current) {
          nuevoEstatusFileInputRef.current.value = '';
        }
        if (typeof data.lastUpdated === 'string') {
          setNuevoEstatusLastUpdated(data.lastUpdated);
        }
        cargarNuevoEstatus();
      } else {
        alert(data.mensaje || 'Error al cargar información');
      }
    } catch (err) {
      alert('Error de conexión al cargar información');
    }
  };

  const handleDeleteOrdenes = async () => {
    if (!esSupervisor) return;
    if (!ordenesGridRef.current) return;
    const selectedRows = ordenesGridRef.current.api.getSelectedRows();
    if (selectedRows.length === 0) {
      alert('Selecciona al menos un renglón para borrar.');
      return;
    }
    const ids = selectedRows.map(row => row.id);
    try {
  const res = await fetch(`${API_BASE_URL}/api/basedatos/ordenes-proveedor/borrar`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (data.ok) {
        cargarOrdenes();
        cargarDatos();
        setOrdenesSelectedCount(0);
        ordenesGridRef.current.api.deselectAll();
      } else {
        alert(data.mensaje || 'Error al borrar');
      }
    } catch (err) {
      alert('Error de conexión al borrar');
    }
  };

  const handleOrdenesFileUpload = (e) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      if (!bstr) return;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' }).map(row => ({
        PEDIDO: row.PEDIDO || row.pedido || row['Pedido'] || row['PEDIDO '] || '',
        ORDEN_PROVEEDOR: row['ORDEN PROVEEDOR'] || row.ORDEN_PROVEEDOR || row.orden_proveedor || row['Orden proveedor'] || ''
      })).filter(row => row.PEDIDO || row.ORDEN_PROVEEDOR);
      setOrdenesExcelData(data);
      setOrdenesPuedeCargar(data.length > 0);
    };
    reader.readAsBinaryString(file);
  };

  const handleCargarOrdenesExcel = async () => {
    if (ordenesExcelData.length === 0) return;
    try {
  const res = await fetch(`${API_BASE_URL}/api/basedatos/ordenes-proveedor/insertar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ordenesExcelData)
      });
      const data = await res.json();
      if (data.ok) {
        setOrdenesExcelData([]);
        setOrdenesPuedeCargar(false);
        cargarOrdenes();
        cargarDatos();
      } else {
        alert(data.mensaje || 'Error al cargar información');
      }
    } catch (err) {
      alert('Error de conexión al cargar información');
    }
  };

  const applyStoredColumnWidths = useCallback((columnApi) => {
    if (!columnApi) return;
    const storedRaw = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    if (!storedRaw) return;
    try {
      const stored = JSON.parse(storedRaw);
      if (!stored || typeof stored !== 'object') return;
      const state = Object.entries(stored)
        .filter(([, width]) => typeof width === 'number' && width > 0)
        .map(([colId, width]) => ({ colId, width }));
      if (!state.length) return;
      columnApi.applyColumnState({ state, applyOrder: false });
    } catch (err) {
      console.warn('No se pudo leer los anchos guardados:', err);
    }
  }, []);

  const handleGridReady = useCallback((params) => {
    applyStoredColumnWidths(params?.columnApi);
  }, [applyStoredColumnWidths]);

  const handleColumnResized = useCallback((event) => {
    if (!event?.finished) return;
    const state = event.api?.getColumnState?.();
    if (!Array.isArray(state)) return;
    const widths = {};
    state.forEach(col => {
      if (!col?.colId) return;
      if (typeof col.width !== 'number' || Number.isNaN(col.width)) return;
      widths[col.colId] = col.width;
    });
    try {
      localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
    } catch (err) {
      console.warn('No se pudieron guardar los anchos de las columnas:', err);
    }
  }, []);

  useEffect(() => {
    if (!gridRef.current?.columnApi) return;
    applyStoredColumnWidths(gridRef.current.columnApi);
  }, [filteredColumnDefs, applyStoredColumnWidths]);

  useEffect(() => {
    if (!nuevoEstatusGridRef.current?.columnApi) return;
    applyStoredColumnWidths(nuevoEstatusGridRef.current.columnApi);
  }, [filteredColumnDefs, applyStoredColumnWidths]);

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => setActiveTab('principal')}
          style={{
            padding: '8px 16px',
            borderRadius: 12,
            border: activeTab === 'principal' ? '1px solid #9aa5b1' : '1px solid #d0d5dd',
            background: activeTab === 'principal' ? '#eef2ff' : '#f8fafc',
            fontWeight: activeTab === 'principal' ? '600' : '500',
            color: '#1f2937',
            cursor: 'pointer'
          }}
        >
          Base de datos principal
        </button>
        <button
          onClick={() => setActiveTab('nuevo-estatus')}
          style={{
            padding: '8px 16px',
            borderRadius: 12,
            border: activeTab === 'nuevo-estatus' ? '1px solid #9aa5b1' : '1px solid #d0d5dd',
            background: activeTab === 'nuevo-estatus' ? '#eef2ff' : '#f8fafc',
            fontWeight: activeTab === 'nuevo-estatus' ? '600' : '500',
            color: '#1f2937',
            cursor: 'pointer'
          }}
        >
          Nuevo estatus
        </button>
        {esSupervisor && (
          <button
            onClick={() => setActiveTab('ordenes')}
            style={{
              padding: '8px 16px',
              borderRadius: 12,
              border: activeTab === 'ordenes' ? '1px solid #9aa5b1' : '1px solid #d0d5dd',
              background: activeTab === 'ordenes' ? '#eef2ff' : '#f8fafc',
              fontWeight: activeTab === 'ordenes' ? '600' : '500',
              color: '#1f2937',
              cursor: 'pointer'
            }}
          >
            Órdenes de proveedor
          </button>
        )}
      </div>

      {activeTab === 'principal' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section
            style={{
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 16,
              padding: 20,
              boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>
                  {inspectorField ? inspectorHeader : 'Inspector de celdas'}
                </div>
                {inspectorField ? (
                  <>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                      {inspectorRowId ? `Registro #${inspectorRowId}` : 'Sin identificador'}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {inspectorIsEditable ? 'Los cambios se guardan al terminar la edición.' : 'Solo lectura.'}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    Selecciona una celda para ver su contenido.
                  </div>
                )}
              </div>
              <button
                onClick={handleDialogCancel}
                onMouseDown={() => { inspectorSuppressCommitRef.current = true; }}
                disabled={!inspectorField}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  background: inspectorField ? '#f9fafb' : '#f3f4f6',
                  cursor: inspectorField ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                  color: '#111827',
                  opacity: inspectorField ? 1 : 0.6
                }}
              >
                Limpiar selección
              </button>
            </div>
            {inspectorField ? (
              <div>
                {inspectorIsEditable ? (
                  inspectorField === 'LOCALIDAD' || inspectorField === 'COMPAQ' ? (
                    <select
                      ref={dialogInputRef}
                      value={inspectorValue}
                      onChange={handleDialogValueChange}
                      onBlur={handleDialogBlur}
                      onKeyDown={handleDialogKeyDown}
                      style={{
                        width: '100%',
                        padding: 10,
                        borderRadius: 12,
                        border: '1px solid #d1d5db',
                        background: '#f9fafb',
                        fontSize: 13
                      }}
                    >
                      {inspectorField === 'LOCALIDAD' && (
                        <option value="">Selecciona una opción</option>
                      )}
                      {inspectorField === 'COMPAQ' && inspectorValue === '' && (
                        <option value="" disabled>
                          Selecciona una opción
                        </option>
                      )}
                      {(inspectorField === 'LOCALIDAD' ? ALLOWED_LOCALIDADES : COMPAQ_OPTIONS).map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      ref={dialogInputRef}
                      value={inspectorValue}
                      onChange={handleDialogValueChange}
                      onBlur={handleDialogBlur}
                      onKeyDown={handleDialogKeyDown}
                      rows={3}
                      placeholder="Escribe el valor..."
                      style={{
                        width: '100%',
                        padding: 12,
                        borderRadius: 12,
                        border: '1px solid #d1d5db',
                        resize: 'vertical',
                        fontSize: 13,
                        minHeight: 85
                      }}
                    />
                  )
                ) : (
                  <div
                    style={{
                      minHeight: 85,
                      borderRadius: 12,
                      border: '1px solid #d1d5db',
                      background: '#f9fafb',
                      padding: 14,
                      fontSize: 13,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {inspectorValue || '(vacío)'}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  minHeight: 85,
                  borderRadius: 12,
                  border: '1px solid #e5e7eb',
                  background: '#f9fafb',
                  padding: 16,
                  fontSize: 13,
                  color: '#6b7280'
                }}
              >
                No hay una celda seleccionada.
              </div>
            )}
          </section>

          <section style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Base de Datos</h2>
            <div style={{ marginBottom: 10 }}>
              {esSupervisor && (
                <button
                  onClick={handleDeleteSelected}
                  style={{ background: '#dc2626', color: '#fff', fontWeight: 'bold', padding: '6px 14px', borderRadius: 8, border: 'none' }}
                  disabled={selectedCount === 0}
                >
                  Borrar seleccionados
                </button>
              )}
              <span style={{ marginLeft: 16, fontWeight: 'bold', color: '#047857' }}>
                Seleccionadas: {selectedCount}
              </span>
              <span style={{ marginLeft: 16, fontWeight: 'bold', color: '#3730a3' }}>
                Total de filas: {filteredDataMemo.length}
              </span>
            </div>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Buscar..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={{ padding: 6, minWidth: 220, borderRadius: 8, border: '1px solid #d0d5dd' }}
              />
              <select
                value={searchType}
                onChange={e => setSearchType(e.target.value)}
                style={{ padding: 6, borderRadius: 8, border: '1px solid #d0d5dd' }}
              >
                <option value="contiene">Que contenga</option>
                <option value="exacta">Coincidencia exacta</option>
                <option value="no_contiene">No contiene</option>
              </select>
              <button
                onClick={handleAutoAssignLocalidades}
                disabled={isAssigningLocalidades}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d1fae5', background: isAssigningLocalidades ? '#e5e7eb' : '#bbf7d0', cursor: isAssigningLocalidades ? 'not-allowed' : 'pointer', fontWeight: 600 }}
              >
                {isAssigningLocalidades ? 'Asignando...' : 'Completar localidades'}
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
              <button
                onClick={() => setShowColumnListPrincipal(prev => !prev)}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: showColumnListPrincipal ? '#e0e7ff' : '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
              >
                {showColumnListPrincipal ? 'Ocultar selector de columnas' : 'Seleccionar columnas'}
              </button>
            </div>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Aplicar segundo filtro..."
                value={secondarySearchText}
                onChange={e => setSecondarySearchText(e.target.value)}
                style={{ padding: 6, minWidth: 220, borderRadius: 8, border: '1px solid #d0d5dd' }}
              />
              <select
                value={secondarySearchType}
                onChange={e => setSecondarySearchType(e.target.value)}
                style={{ padding: 6, borderRadius: 8, border: '1px solid #d0d5dd' }}
              >
                <option value="contiene">Que contenga</option>
                <option value="exacta">Coincidencia exacta</option>
                <option value="no_contiene">No contiene</option>
              </select>
              {secondarySearchText && (
                <button
                  type="button"
                  onClick={() => {
                    setSecondarySearchText('');
                    setSecondarySearchType('contiene');
                  }}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
                >
                  Limpiar filtro secundario
                </button>
              )}
            </div>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Aplicar tercer filtro..."
                value={tertiarySearchText}
                onChange={e => setTertiarySearchText(e.target.value)}
                style={{ padding: 6, minWidth: 220, borderRadius: 8, border: '1px solid #d0d5dd' }}
              />
              <select
                value={tertiarySearchType}
                onChange={e => setTertiarySearchType(e.target.value)}
                style={{ padding: 6, borderRadius: 8, border: '1px solid #d0d5dd' }}
              >
                <option value="contiene">Que contenga</option>
                <option value="exacta">Coincidencia exacta</option>
                <option value="no_contiene">No contiene</option>
              </select>
              {tertiarySearchText && (
                <button
                  type="button"
                  onClick={() => {
                    setTertiarySearchText('');
                    setTertiarySearchType('contiene');
                  }}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
                >
                  Limpiar tercer filtro
                </button>
              )}
            </div>
            {showColumnListPrincipal && (
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
            <div className="ag-theme-alpine"
              style={{
                height: 500,
                width: '100%',
                fontSize: '13px',
                overflow: 'auto',
                borderRadius: 12
              }}>
              <AgGridReact
                ref={gridRef}
                columnDefs={filteredColumnDefs}
                rowData={filteredDataMemo}
                rowSelection="multiple"
                getRowId={getPrincipalRowId}
                domLayout="normal"
                suppressHorizontalScroll={false}
                suppressMovableColumns={true}
                enableBrowserTooltips={true}
                enableCellTextSelection={true}
                deltaRowDataMode={true}
                defaultColDef={{
                  resizable: true,
                  sortable: false,
                  filter: false,
                  minWidth: 40,
                  editable: false,
                }}
                headerHeight={32}
                rowHeight={28}
                onSelectionChanged={onSelectionChanged}
                onCellClicked={handleCellClicked}
                onCellFocused={handleCellFocused}
                onCellValueChanged={handlePrincipalCellEdit}
                onGridReady={handleGridReady}
                onColumnResized={handleColumnResized}
                singleClickEdit={true}
                stopEditingWhenCellsLoseFocus={true}
              />
            </div>
          </section>
        </div>
      )}

      {activeTab === 'nuevo-estatus' && (
        <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Nuevo estatus</h2>
          <p style={{ marginTop: 0, color: '#6b7280' }}>
            Tabla auxiliar con las mismas columnas de la base de datos para un nuevo seguimiento de estatus.
          </p>
          <div style={{ marginBottom: 10 }}>
            {esSupervisor && (
              <button
                onClick={handleDeleteNuevoEstatus}
                style={{ background: '#dc2626', color: '#fff', fontWeight: 'bold', padding: '6px 14px', borderRadius: 8, border: 'none' }}
                disabled={nuevoEstatusSelectedCount === 0}
              >
                Borrar seleccionados
              </button>
            )}
            <span style={{ marginLeft: 16, fontWeight: 'bold', color: '#047857' }}>
              Seleccionadas: {nuevoEstatusSelectedCount}
            </span>
            <span style={{ marginLeft: 16, fontWeight: 'bold', color: '#3730a3' }}>
              Total de filas: {filteredNuevoEstatus.length}
            </span>
          </div>
          {puedeGestionarNuevoEstatus && (
            <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <input
                type="file"
                accept=".xlsx, .xls"
                ref={nuevoEstatusFileInputRef}
                style={{ display: 'none' }}
                onChange={handleNuevoEstatusFileUpload}
              />
              <button
                onClick={() => nuevoEstatusFileInputRef.current?.click()}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f3f4f6', cursor: 'pointer' }}
              >
                Seleccionar Excel
              </button>
              <button
                onClick={handleCargarNuevoEstatusExcel}
                disabled={!nuevoEstatusPuedeCargar}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: nuevoEstatusPuedeCargar ? '#2563eb' : '#93c5fd', color: '#fff', fontWeight: 600, cursor: nuevoEstatusPuedeCargar ? 'pointer' : 'not-allowed' }}
              >
                Cargar información
              </button>
              {nuevoEstatusExcelData.length > 0 && (
                <span style={{ color: '#0f766e', fontWeight: 600 }}>
                  {nuevoEstatusExcelData.length} filas listas para cargar
                </span>
              )}
            </div>
          )}
          {formattedNuevoEstatusLastUpdated && (
            <div style={{ marginBottom: 12, color: '#2563eb', fontWeight: 600 }}>
              Última actualización: {formattedNuevoEstatusLastUpdated}
            </div>
          )}
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Buscar..."
              value={searchNuevoText}
              onChange={e => setSearchNuevoText(e.target.value)}
              style={{ padding: 6, minWidth: 220, borderRadius: 8, border: '1px solid #d0d5dd' }}
            />
            <button
              onClick={() => setShowColumnListNuevo(prev => !prev)}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: showColumnListNuevo ? '#e0e7ff' : '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
            >
              {showColumnListNuevo ? 'Ocultar selector de columnas' : 'Seleccionar columnas'}
            </button>
          </div>
          {showColumnListNuevo && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, border: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
              {baseColumnFields.map(field => (
                <label key={`nuevo-${field}`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 200, fontSize: 13 }}>
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
          <div className="ag-theme-alpine"
            style={{
              height: 500,
              width: '100%',
              fontSize: '13px',
              overflow: 'auto',
              borderRadius: 12
            }}>
            <AgGridReact
              ref={nuevoEstatusGridRef}
              columnDefs={filteredColumnDefs}
              rowData={filteredNuevoEstatus}
              rowSelection="multiple"
              getRowId={getNuevoEstatusRowId}
              domLayout="normal"
              suppressHorizontalScroll={false}
              suppressMovableColumns={true}
              enableBrowserTooltips={true}
              enableCellTextSelection={true}
              defaultColDef={{
                resizable: true,
                sortable: false,
                filter: false,
                minWidth: 40,
                editable: false,
              }}
              headerHeight={32}
              rowHeight={28}
              onSelectionChanged={onNuevoEstatusSelectionChanged}
              onGridReady={handleGridReady}
              onColumnResized={handleColumnResized}
            />
          </div>
        </div>
      )}

      {esSupervisor && activeTab === 'ordenes' && (
        <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Órdenes de Proveedor</h2>
          <p style={{ marginTop: 0, color: '#6b7280' }}>Tabla auxiliar para relacionar pedidos con su orden de proveedor.</p>
          <div style={{ marginBottom: 10 }}>
            {esSupervisor && (
              <button
                onClick={handleDeleteOrdenes}
                style={{ background: '#dc2626', color: '#fff', fontWeight: 'bold', padding: '6px 14px', borderRadius: 8, border: 'none' }}
                disabled={ordenesSelectedCount === 0}
              >
                Borrar seleccionados
              </button>
            )}
            <span style={{ marginLeft: 16, fontWeight: 'bold', color: '#047857' }}>
              Seleccionadas: {ordenesSelectedCount}
            </span>
            <span style={{ marginLeft: 16, fontWeight: 'bold', color: '#3730a3' }}>
              Total de filas: {filteredOrdenes.length}
            </span>
          </div>
          <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <input
              type="file"
              accept=".xlsx, .xls"
              ref={ordenesFileInputRef}
              style={{ display: 'none' }}
              onChange={handleOrdenesFileUpload}
            />
            <button
              onClick={() => ordenesFileInputRef.current?.click()}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f3f4f6', cursor: 'pointer' }}
            >
              Subir Excel de órdenes
            </button>
            <button
              onClick={handleCargarOrdenesExcel}
              disabled={!ordenesPuedeCargar}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: ordenesPuedeCargar ? '#2563eb' : '#93c5fd', color: '#fff', fontWeight: 600, cursor: ordenesPuedeCargar ? 'pointer' : 'not-allowed' }}
            >
              Cargar información
            </button>
            {ordenesExcelData.length > 0 && (
              <span style={{ color: '#0f766e', fontWeight: 600 }}>
                {ordenesExcelData.length} filas listas para cargar
              </span>
            )}
          </div>
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              placeholder="Buscar pedido u orden..."
              value={searchOrdenText}
              onChange={e => setSearchOrdenText(e.target.value)}
              style={{ padding: 6, minWidth: 240, borderRadius: 8, border: '1px solid #d0d5dd' }}
            />
          </div>
          <div className="ag-theme-alpine"
            style={{
              height: 400,
              width: '100%',
              fontSize: '13px',
              overflow: 'auto',
              borderRadius: 12
            }}>
            <AgGridReact
              ref={ordenesGridRef}
              columnDefs={ordenesColumnDefs}
              rowData={filteredOrdenes}
              rowSelection="multiple"
              getRowId={getOrdenRowId}
              domLayout="normal"
              suppressHorizontalScroll={false}
              suppressMovableColumns={true}
              enableBrowserTooltips={true}
              enableCellTextSelection={true}
              defaultColDef={{
                resizable: true,
                sortable: false,
                filter: false,
                minWidth: 40,
                editable: false,
              }}
              headerHeight={32}
              rowHeight={28}
              onSelectionChanged={onOrdenSelectionChanged}
            />
          </div>
        </div>
      )}

    </div>
  );
};

export default BaseDatosPage;