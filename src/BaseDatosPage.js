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
const ESTATUS_EDITABLE_FIELDS = new Set(['NUEVO_ESTATUS', 'ESTATUS2']);
const CAPTURA_EDITABLE_FIELDS = new Set(['CODIGO', 'CHOFER']);

const BaseDatosPage = () => {
  const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
  const role = (usuario.role || '').toString().toLowerCase();
  const esSupervisor = role === 'supervisor';
  const puedeGestionarNuevoEstatus = esSupervisor || role === 'seguimientos';

  const [baseDataRaw, setBaseDataRaw] = useState([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState('contiene');
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
  const gridRef = useRef();
  const revertingRef = useRef(false);
  const nuevoEstatusGridRef = useRef();
  const ordenesGridRef = useRef();
  const ordenesFileInputRef = useRef();
  const nuevoEstatusFileInputRef = useRef();
  const [nuevoEstatusExcelData, setNuevoEstatusExcelData] = useState([]);
  const [nuevoEstatusPuedeCargar, setNuevoEstatusPuedeCargar] = useState(false);
  const [showColumnListPrincipal, setShowColumnListPrincipal] = useState(false);
  const [showColumnListNuevo, setShowColumnListNuevo] = useState(false);
  const [isAssigningLocalidades, setIsAssigningLocalidades] = useState(false);
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
      cargarDatos();
      cargarOrdenes();
      cargarNuevoEstatus();
    });
    socket.on('nuevo_estatus_updated', (payload) => {
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
    if (!searchText) return principalRowData;
    const lower = searchText.toLowerCase();
    return principalRowData.filter(row =>
      Object.values(row).some(val => {
        if (typeof val !== 'string' && typeof val !== 'number') return false;
        const cell = String(val).toLowerCase();
        return searchType === 'exacta' ? cell === lower : cell.includes(lower);
      })
    );
  }, [principalRowData, searchText, searchType]);

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

  const handlePrincipalCellEdit = useCallback((params) => {
    if (revertingRef.current) return;

    const field = params?.colDef?.field;
    if (!field) return;

    const esCampoEstatus = ESTATUS_EDITABLE_FIELDS.has(field);
    const requiereSupervisor = CAPTURA_EDITABLE_FIELDS.has(field);

    if ((esCampoEstatus && !puedeGestionarNuevoEstatus) || (requiereSupervisor && !esSupervisor)) {
      revertingRef.current = true;
      params.node.setDataValue(field, params.oldValue ?? '');
      revertingRef.current = false;
      return;
    }

    if (field !== 'LOCALIDAD' && !esCampoEstatus && !CAPTURA_EDITABLE_FIELDS.has(field)) return;

    const rowId = params?.data?.id;
    const numericId = Number(rowId);
    if (!Number.isInteger(numericId)) {
      revertingRef.current = true;
      params.node.setDataValue(field, params.oldValue ?? '');
      revertingRef.current = false;
      return;
    }

    const normalizeValue = (raw) => {
      if (raw == null) return '';
      return typeof raw === 'string' ? raw : String(raw);
    };

    const originalValue = normalizeValue(params.oldValue);
    const enteredValue = normalizeValue(params.newValue);

    if (field === 'LOCALIDAD') {
      const trimmed = enteredValue.trim();
      if (!trimmed) {
        revertingRef.current = true;
        params.node.setDataValue(field, originalValue);
        revertingRef.current = false;
        return;
      }

      const matchingOption = ALLOWED_LOCALIDADES.find(option => option.toLowerCase() === trimmed.toLowerCase());
      if (!matchingOption) {
        alert('Ingresa "local" o "foraneo".');
        revertingRef.current = true;
        params.node.setDataValue(field, originalValue);
        revertingRef.current = false;
        return;
      }

      if (originalValue.trim().toLowerCase() === matchingOption.toLowerCase()) {
        if (params.value !== matchingOption) {
          revertingRef.current = true;
          params.node.setDataValue(field, matchingOption);
          revertingRef.current = false;
        }
        return;
      }

      fetch(`${API_BASE_URL}/api/basedatos/actualizar-estatus`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: numericId, field, value: matchingOption })
      })
        .then(res => res.json())
        .then(data => {
          if (!data?.ok) {
            throw new Error(data?.mensaje || 'No se pudo actualizar la localidad.');
          }
          revertingRef.current = true;
          params.node.setDataValue(field, matchingOption);
          revertingRef.current = false;
        })
        .catch(err => {
          console.error('No se pudo actualizar la localidad:', err);
          alert('No se pudo guardar la localidad.');
          revertingRef.current = true;
          params.node.setDataValue(field, originalValue);
          revertingRef.current = false;
        });
      return;
    }

    if (esCampoEstatus) {
      const finalValue = enteredValue.trim();
      if (originalValue === finalValue) {
        if (params.value !== finalValue) {
          revertingRef.current = true;
          params.node.setDataValue(field, finalValue);
          revertingRef.current = false;
        }
        return;
      }

      fetch(`${API_BASE_URL}/api/basedatos/actualizar-estatus`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: numericId, field, value: finalValue })
      })
        .then(res => res.json())
        .then(data => {
          if (!data?.ok) {
            throw new Error(data?.mensaje || 'No se pudo actualizar el valor.');
          }
          revertingRef.current = true;
          params.node.setDataValue(field, finalValue);
          revertingRef.current = false;
        })
        .catch(err => {
          console.error('No se pudo actualizar el valor:', err);
          alert('No se pudo guardar el cambio.');
          revertingRef.current = true;
          params.node.setDataValue(field, originalValue);
          revertingRef.current = false;
        });
      return;
    }

    if (CAPTURA_EDITABLE_FIELDS.has(field)) {
      const finalValue = enteredValue.trim();
      if (originalValue === finalValue) {
        if (params.value !== finalValue) {
          revertingRef.current = true;
          params.node.setDataValue(field, finalValue);
          revertingRef.current = false;
        }
        return;
      }

      fetch(`${API_BASE_URL}/api/basedatos/captura/actualizar-celda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: numericId, field, value: finalValue })
      })
        .then(res => res.json())
        .then(data => {
          if (!data?.ok) {
            throw new Error(data?.mensaje || 'No se pudo actualizar el valor.');
          }
          revertingRef.current = true;
          params.node.setDataValue(field, finalValue);
          revertingRef.current = false;
        })
        .catch(err => {
          console.error('No se pudo actualizar el valor:', err);
          alert('No se pudo guardar el cambio.');
          revertingRef.current = true;
          params.node.setDataValue(field, originalValue);
          revertingRef.current = false;
        });
      return;
    }
  }, [esSupervisor, puedeGestionarNuevoEstatus]);

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
        <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20 }}>
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
            </select>
            <button
              onClick={handleAutoAssignLocalidades}
              disabled={isAssigningLocalidades}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d1fae5', background: isAssigningLocalidades ? '#e5e7eb' : '#bbf7d0', cursor: isAssigningLocalidades ? 'not-allowed' : 'pointer', fontWeight: 600 }}
            >
              {isAssigningLocalidades ? 'Asignando...' : 'Completar localidades'}
            </button>
            <button
              onClick={() => setShowColumnListPrincipal(prev => !prev)}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: showColumnListPrincipal ? '#e0e7ff' : '#f3f4f6', cursor: 'pointer', fontWeight: 600 }}
            >
              {showColumnListPrincipal ? 'Ocultar selector de columnas' : 'Seleccionar columnas'}
            </button>
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
              domLayout="normal"
              suppressHorizontalScroll={false}
              suppressMovableColumns={true}
              enableBrowserTooltips={true}
              enableCellTextSelection={true}
              defaultColDef={{
                resizable: true,
                sortable: true,
                filter: false,
                minWidth: 40,
                editable: false,
              }}
              headerHeight={32}
              rowHeight={28}
              onSelectionChanged={onSelectionChanged}
              onCellValueChanged={handlePrincipalCellEdit}
              singleClickEdit={true}
              stopEditingWhenCellsLoseFocus={true}
            />
          </div>
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
              domLayout="normal"
              suppressHorizontalScroll={false}
              suppressMovableColumns={true}
              enableBrowserTooltips={true}
              enableCellTextSelection={true}
              defaultColDef={{
                resizable: true,
                sortable: true,
                filter: false,
                minWidth: 40,
                editable: false,
              }}
              headerHeight={32}
              rowHeight={28}
              onSelectionChanged={onNuevoEstatusSelectionChanged}
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
              domLayout="normal"
              suppressHorizontalScroll={false}
              suppressMovableColumns={true}
              enableBrowserTooltips={true}
              enableCellTextSelection={true}
              defaultColDef={{
                resizable: true,
                sortable: true,
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