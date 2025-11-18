import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { io as socketIOClient } from 'socket.io-client';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import * as XLSX from 'xlsx';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import './CodificarPage.css';
import { API_BASE_URL, SOCKET_URL } from './config';

ModuleRegistry.registerModules([AllCommunityModule]);

const normalizeKeyPart = (value) => (value ?? '').toString().trim().toUpperCase();

const buildSiniestroItemKey = (siniestro, item) => {
  const siniestroKey = normalizeKeyPart(siniestro);
  const itemKey = normalizeKeyPart(item);
  if (!siniestroKey && !itemKey) return '';
  return `${siniestroKey}|||${itemKey}`;
};

const extractSiniestro = (row) => row?.SINIESTRO ?? row?.siniestro ?? row?.Siniestro ?? '';
const extractItem = (row) => row?.ITEM ?? row?.item ?? row?.Item ?? '';
const extractPedido = (row) => row?.PEDIDO ?? row?.pedido ?? row?.Pedido ?? '';

const buildPedidoItemKey = (pedido, item) => {
  const pedidoKey = normalizeKeyPart(pedido);
  const itemKey = normalizeKeyPart(item);
  if (!pedidoKey && !itemKey) return '';
  return `${pedidoKey}|||${itemKey}`;
};

function excelDateToJSDate(serial) {
  if (typeof serial !== 'number' || Number.isNaN(serial)) return '';

  const milliseconds = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return '';

  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  );
}

function parseFechaDDMMYYYY(fechaStr) {
  if (!fechaStr) return null;
  const [fecha, hora] = fechaStr.split(' ');
  if (!fecha) return null;
  const [dia, mes, anio] = fecha.split('/');
  if (!dia || !mes || !anio) return null;
  let h = 0, m = 0, s = 0;
  if (hora) {
    [h, m, s] = hora.split(':').map(Number);
  }
  // Mes en JS es 0-indexado
  return new Date(Number(anio), Number(mes) - 1, Number(dia), h, m, s);
}

const formatFecha = params => {
  if (!params.value) return '';
  // Si es string en formato dd/mm/yyyy, parsea correctamente
  if (typeof params.value === 'string' && params.value.match(/^\d{2}\/\d{2}\/\d{4}/)) {
    const date = parseFechaDDMMYYYY(params.value);
    if (date && !isNaN(date.getTime())) {
      return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
  }
  // Si es string numérico (Excel), conviértelo a número
  let value = params.value;
  if (typeof value === 'string' && !isNaN(value) && value.trim() !== '') {
    value = Number(value);
  }
  if (typeof value === 'number' && !isNaN(value)) {
    const date = excelDateToJSDate(value);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
  }
  // Si es string en otro formato, intenta parsear normal
  const date = new Date(params.value);
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' +
      date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  return params.value;
};

const columnDefs = [
  { headerName: '', field: 'checked', checkboxSelection: true, headerCheckboxSelection: true, width: 30, pinned: 'left' },
  { headerName: "ASEGURADORA", field: "ASEGURADORA", width: 180 },
  { headerName: "COTIZACION", field: "COTIZACION", width: 120 },
  { headerName: "PEDIDO", field: "PEDIDO", width: 120 },
  { headerName: "FECHA COTIZACION", field: "FECHA_COTIZACION", width: 160, valueFormatter: formatFecha },
  { headerName: "FECHA PEDIDO", field: "FECHA_PEDIDO", width: 180, valueFormatter: formatFecha },
  { headerName: "PROMESA DE ENTREGA", field: "PROMESA_DE_ENTREGA", width: 150, valueFormatter: formatFecha },
  { headerName: "FECHA CONFIRMACION DE PIEZA", field: "FECHA_CONFIRMACION_DE_PIEZA", width: 180, valueFormatter: formatFecha },
  { headerName: "FECHA CANCELACION DE PIEZA", field: "FECHA_CANCELACION_DE_PIEZA", width: 180, valueFormatter: formatFecha },
  { headerName: "FECHA FACTURACION DE PIEZA", field: "FECHA_FACTURACION_DE_PIEZA", width: 180, valueFormatter: formatFecha },
  { headerName: "FECHA ENTREGA DE PIEZA", field: "FECHA_ENTREGA_DE_PIEZA", width: 180, valueFormatter: formatFecha },
  { headerName: "FECHA RECEPCION DE PIEZA", field: "FECHA_RECEPCION_DE_PIEZA", width: 180, valueFormatter: formatFecha },
  { headerName: "DIAS PROMESA", field: "DIAS_PROMESA", width: 120 },
  { headerName: "DIAS ENTREGADO1", field: "DIAS_ENTREGADO1", width: 220 },
  { headerName: "DIAS ENTREGADO2", field: "DIAS_ENTREGADO2", width: 250 },
  { headerName: "DIAS RECIBIDO1", field: "DIAS_RECIBIDO1", width: 220 },
  { headerName: "DIAS RECIBIDO2", field: "DIAS_RECIBIDO2", width: 220 },
  { headerName: "SINIESTRO", field: "SINIESTRO", width: 180 },
  { headerName: "NOMBRE COMERCIAL TALLER", field: "NOMBRE_COMERCIAL_TALLER", width: 250 },
  { headerName: "CIUDAD TALLER", field: "CIUDAD_TALLER", width: 150 },
  { headerName: "ESTADO TALLER", field: "ESTADO_TALLER", width: 150 },
  { headerName: "NOMBRE CONTACTO", field: "NOMBRE_CONTACTO", width: 180 },
  { headerName: "TELEFONO", field: "TELEFONO", width: 130 },
  { headerName: "EMAIL", field: "EMAIL", width: 200 },
  { headerName: "ARMADORA", field: "ARMADORA", width: 120 },
  { headerName: "MODELO", field: "MODELO", width: 180 },
  { headerName: "ANIO", field: "ANIO", width: 80 },
  { headerName: "RFC PROVEEDOR", field: "RFC_PROVEEDOR", width: 150 },
  { headerName: "RAZON SOCIAL PROVEEDOR", field: "RAZON_SOCIAL_PROVEEDOR", width: 200 },
  { headerName: "NOMBRE COMERCIAL PROVEEDOR", field: "NOMBRE_COMERCIAL_PROVEEDOR", width: 200 },
  { headerName: "COLUMNA1", field: "COLUMNA1", width: 120 },
  { headerName: "ESTADO PROVEEDOR", field: "ESTADO_PROVEEDOR", width: 150 },
  { headerName: "ITEM", field: "ITEM", width: 230 },
  { headerName: "ORIGEN", field: "ORIGEN", width: 100 },
  { headerName: "PRECIO", field: "PRECIO", width: 90 },
  { headerName: "ESTATUS", field: "ESTATUS", width: 120 },
  { headerName: "BACK ORDER", field: "BACK_ORDER", width: 120 },
  {
    headerName: "CODIGO",
    field: "CODIGO",
    width: 150,
    editable: true
  },
  { headerName: "COSTO", field: "COSTO", width: 100, editable: true },
  { headerName: "LOCALIDAD", field: "LOCALIDAD", width: 150 },
  { headerName: "CHOFER", field: "CHOFER", width: 120, editable: true },
  { headerName: "COMPAQ", field: "COMPAQ", width: 120 },
  { headerName: "OC", field: "OC", width: 100 },
  { headerName: "NUEVO ESTATUS", field: "NUEVO_ESTATUS", width: 150 },
  { headerName: "ESTATUS LOCAL", field: "ESTATUS_LOCAL", width: 150 },
  { headerName: "ESTATUS FORANEO", field: "ESTATUS_FORANEO", width: 150 },
  { headerName: "ESTATUS2", field: "ESTATUS2", width: 120 },
];

const LOCAL_STORAGE_COLS_KEY = 'visibleColumns';
const LOCAL_STORAGE_PANEL_KEY = 'showColumnPanel';

const CodificarPage = () => {
  const [rowData, setRowData] = useState([]);
  const [excelData, setExcelData] = useState([]);
  const [paresSiniestroItemBase, setParesSiniestroItemBase] = useState([]);
  const [paresPedidoItemBase, setParesPedidoItemBase] = useState([]);
  const fileInputRef = useRef();
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_COLS_KEY);
    if (saved) return JSON.parse(saved);
    return columnDefs.map(col => col.field);
  });
  const [showColumnPanel, setShowColumnPanel] = useState(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_PANEL_KEY);
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [selectedCount, setSelectedCount] = useState(0);
  const [editTooltip, setEditTooltip] = useState({ show: false, x: 0, y: 0, value: "" });
  const gridRef = useRef();
  const [inspectorCell, setInspectorCell] = useState(null);

  // NUEVO: Estado para controlar si se puede cargar información
  const [puedeCargar, setPuedeCargar] = useState(false);
  const [mostrarResumen, setMostrarResumen] = useState(false);
  const undoStackRef = useRef([]);
  const isApplyingUndoRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);

  const handleCellValueChanged = params => {
    const { data, newValue, colDef, node, api } = params;
    const field = colDef.field;
    if (!field) return;
    const nuevoCompaq =
      field === "CODIGO" && newValue && newValue.trim() !== "" ? "GENERAR" : "";

    const normalizeValue = (raw) => {
      if (raw === null || typeof raw === 'undefined') return '';
      return typeof raw === 'string' ? raw : String(raw);
    };

    const previousValue = normalizeValue(params.oldValue);
    const appliedNewValue = normalizeValue(newValue);

    if (!isApplyingUndoRef.current && field && data?.id != null && previousValue !== appliedNewValue) {
      undoStackRef.current.push({
        id: data.id,
        field,
        previousValue,
        newValue: appliedNewValue
      });
      while (undoStackRef.current.length > 25) {
        undoStackRef.current.shift();
      }
      setCanUndo(true);
    }

    setRowData(prev =>
      prev.map(row =>
        row.id === data.id
          ? {
              ...row,
              [field]: newValue,
              ...(field === "CODIGO" ? { COMPAQ: nuevoCompaq } : {})
            }
          : row
      )
    );

    // Solo desplaza la tabla si la fila salió de la vista; evita brincos al guardar.
  const firstDisplayedIndex = api.getFirstDisplayedRowIndex?.();
  const lastDisplayedIndex = api.getLastDisplayedRowIndex?.();
    if (
      firstDisplayedIndex != null &&
      lastDisplayedIndex != null &&
      (node.rowIndex < firstDisplayedIndex || node.rowIndex > lastDisplayedIndex)
    ) {
      api.ensureIndexVisible(node.rowIndex, 'middle');
    }

    fetch(`${API_BASE_URL}/api/excel/actualizar-celda`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: data.id,
        field,
        value: newValue
      })
    });

    if (field === "CODIGO") {
      fetch(`${API_BASE_URL}/api/excel/actualizar-celda`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: data.id,
          field: "COMPAQ",
          value: nuevoCompaq
        })
      });
    }

    if (isApplyingUndoRef.current) {
      setTimeout(() => {
        isApplyingUndoRef.current = false;
      }, 0);
    }
  };

  // Estados para localidades
  const [localidades, setLocalidades] = useState([]);
  const [localidadesExcel, setLocalidadesExcel] = useState([]);
  const localidadesFileInputRef = useRef();
  const localidadesGridRef = useRef();
  const [localidadesSeleccionadas, setLocalidadesSeleccionadas] = useState([]);
  const [nuevaLocalidad, setNuevaLocalidad] = useState({
    taller: '',
    localidad: '',
    codigo: '',
    nombreCompaq: '',
    nomenclatura: ''
  });
  const [agregando, setAgregando] = useState(false);
  const [editando, setEditando] = useState(null);

  const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
  const rol = (usuario.role || '').toLowerCase();
  const esSupervisor = rol === 'supervisor';
  const esCodificar = rol === 'codificar';

  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('activeTab') || 'principal');

  useEffect(() => {
    // Cargar datos al montar
    const cargarDatos = () => {
      fetch(`${API_BASE_URL}/api/excel/obtener-excel`)
        .then(res => res.json())
        .then(data => setRowData(Array.isArray(data) ? data : []));
    };
    cargarDatos();

    const socket = socketIOClient(SOCKET_URL);
    socket.on('excel_data_updated', cargarDatos);
    socket.on('celda_actualizada', ({ id, field, value, compaq }) => {
      setRowData(prev =>
        prev.map(row =>
          row.id === id
            ? {
                ...row,
                [field]: value,
                ...(compaq !== undefined ? { COMPAQ: compaq } : {})
              }
            : row
        )
      );
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_COLS_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_PANEL_KEY, JSON.stringify(showColumnPanel));
  }, [showColumnPanel]);

  useEffect(() => {
    const cargarClavesBase = () => {
      fetch(`${API_BASE_URL}/api/basedatos/obtener`)
        .then(res => res.json())
        .then(data => {
          if (!Array.isArray(data)) {
            setParesSiniestroItemBase([]);
            setParesPedidoItemBase([]);
            return;
          }

          const siniestroPairs = [];
          const pedidoPairs = [];

          data.forEach(row => {
            const sinKey = buildSiniestroItemKey(extractSiniestro(row), extractItem(row));
            if (sinKey) siniestroPairs.push(sinKey);
            const pedKey = buildPedidoItemKey(extractPedido(row), extractItem(row));
            if (pedKey) pedidoPairs.push(pedKey);
          });

          setParesSiniestroItemBase(siniestroPairs);
          setParesPedidoItemBase(pedidoPairs);
        })
        .catch(err => {
          console.error('No se pudieron cargar claves de base de datos:', err);
          setParesSiniestroItemBase([]);
          setParesPedidoItemBase([]);
        });
    };

    cargarClavesBase();
    window.addEventListener('refreshBaseDatos', cargarClavesBase);
    return () => window.removeEventListener('refreshBaseDatos', cargarClavesBase);
  }, []); // SOLO una vez al montar

  useEffect(() => {
  fetch(`${API_BASE_URL}/api/localidades`)
      .then(res => res.json())
      .then(data => setLocalidades(Array.isArray(data) ? data : []))
      .catch(err => {
        setLocalidades([]);
        console.error(err);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'principal') {
      setInspectorCell(null);
    }
  }, [activeTab]);

  // CRUCE AUTOMÁTICO DE LOCALIDADES
  useEffect(() => {
    if (!Array.isArray(localidades) || localidades.length === 0 || !Array.isArray(rowData) || rowData.length === 0) return;
  
    const diccionarioLocalidades = {};
      localidades.forEach(loc => {
      const key = (loc.taller || loc.Taller || '').trim().toUpperCase();
        diccionarioLocalidades[key] = loc.localidad || loc.Localidad || loc['NOMENCLATURA'] || '';
    });
  
    const nuevoRowData = rowData.map(row => {
      const nombreTaller = (row.NOMBRE_COMERCIAL_TALLER || row['NOMBRE COMERCIAL TALLER'] || '').trim().toUpperCase();
      const localidad = diccionarioLocalidades[nombreTaller] || '';
      if (row.LOCALIDAD !== localidad) {
        return { ...row, LOCALIDAD: localidad };
      }
      return row;
    });
  
    const hayCambios = nuevoRowData.some((row, idx) => row.LOCALIDAD !== rowData[idx].LOCALIDAD);
    if (hayCambios) {
      setRowData(nuevoRowData);
      // Guarda automáticamente después del cruce
  fetch(`${API_BASE_URL}/api/excel/guardar-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevoRowData),
      });
    }
  }, [localidades, rowData]);

  const onSelectionChanged = () => {
    if (gridRef.current) {
      const selectedRows = gridRef.current.api.getSelectedRows();
      setSelectedCount(selectedRows.length);
    }
  };

  // Modifica esta función:
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
      setExcelData(data);
      setPuedeCargar(true);

      // GUARDADO AUTOMÁTICO AL SUBIR ARCHIVO
  fetch(`${API_BASE_URL}/api/excel/guardar-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(() => {
        setPuedeCargar(false); // Deshabilita el botón porque ya se guardó
        setExcelData([]);
        // Opcional: recarga la tabla principal
  fetch(`${API_BASE_URL}/api/excel/obtener-excel`)
          .then(res => res.json())
          .then(data => setRowData(Array.isArray(data) ? data : []));
      });
    };
    reader.readAsBinaryString(file);
  };

  // Modifica esta función:
  const handleLoadData = () => {
    setRowData(prev => {
      const newData = [...prev, ...excelData];
      // Guarda automáticamente después de subir
  fetch(`${API_BASE_URL}/api/excel/guardar-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData),
      });
      return newData;
    });
    setPuedeCargar(false); // Deshabilita el botón después de cargar
    setExcelData([]); // Limpia los datos cargados
  };

  const handleColumnToggle = (field) => {
    setVisibleColumns(prev =>
      prev.includes(field)
        ? prev.filter(f => f !== field)
        : [...prev, field]
    );
  };

  const filteredColumnDefs = columnDefs.filter(
    col => col.field === 'checked' || visibleColumns.includes(col.field)
  );

  const handleSave = async () => {
    try {
  await fetch(`${API_BASE_URL}/api/excel/guardar-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rowData),
      });
      alert('¡Información guardada en el backend!');
    } catch (error) {
      alert('Error al guardar en el backend');
    }
  };

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
  const res = await fetch(`${API_BASE_URL}/api/excel/borrar`, {
        method: 'DELETE',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (data.ok) {
  fetch(`${API_BASE_URL}/api/excel/obtener-excel`)
          .then(res => res.json())
          .then(data => setRowData(Array.isArray(data) ? data : []));
        setSelectedCount(0);
        gridRef.current.api.deselectAll();
      } else {
        alert(data.mensaje || 'Error al borrar');
      }
    } catch (err) {
      alert('Error de conexión al borrar');
    }
  };

  const siniestroItemBaseSet = useMemo(() => {
    const source = Array.isArray(paresSiniestroItemBase) ? paresSiniestroItemBase : [];
    return new Set(source.filter(Boolean));
  }, [paresSiniestroItemBase]);

  const pedidoItemBaseSet = useMemo(() => {
    const source = Array.isArray(paresPedidoItemBase) ? paresPedidoItemBase : [];
    return new Set(source.filter(Boolean));
  }, [paresPedidoItemBase]);

  const siniestroItemDuplicadosCodificar = useMemo(() => {
    if (!Array.isArray(rowData) || rowData.length === 0) {
      return new Set();
    }
    const counts = new Map();
    rowData.forEach(row => {
      const key = buildSiniestroItemKey(extractSiniestro(row), extractItem(row));
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicados = new Set();
    counts.forEach((count, key) => {
      if (count > 1) duplicados.add(key);
    });
    return duplicados;
  }, [rowData]);

  const pedidoItemDuplicadosCodificar = useMemo(() => {
    if (!Array.isArray(rowData) || rowData.length === 0) {
      return new Set();
    }
    const counts = new Map();
    rowData.forEach(row => {
      const key = buildPedidoItemKey(extractPedido(row), extractItem(row));
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicados = new Set();
    counts.forEach((count, key) => {
      if (count > 1) duplicados.add(key);
    });
    return duplicados;
  }, [rowData]);

  const inspectorRowData = useMemo(() => {
    if (!inspectorCell) return null;
    const { rowId, rowKey, snapshot } = inspectorCell;
    if (rowId != null) {
      const matchById = rowData.find(row => row && row.id === rowId);
      if (matchById) return matchById;
    }
    if (rowKey) {
      const matchByKey = rowData.find(row => buildPedidoItemKey(row?.PEDIDO, row?.ITEM) === rowKey);
      if (matchByKey) return matchByKey;
    }
    return snapshot || null;
  }, [inspectorCell, rowData]);

  const inspectorField = inspectorCell?.field ?? null;
  const inspectorHeader = inspectorCell?.header ?? 'Inspector de celdas';
  const inspectorColumn = inspectorField ? columnDefs.find(col => col.field === inspectorField) : null;
  const inspectorIsEditable = Boolean(inspectorColumn?.editable);
  const inspectorPedidoLabel = inspectorRowData && inspectorRowData.PEDIDO != null
    ? String(inspectorRowData.PEDIDO).trim()
    : '';
  const inspectorSiniestroLabel = inspectorRowData && inspectorRowData.SINIESTRO != null
    ? String(inspectorRowData.SINIESTRO).trim()
    : '';
  const inspectorModeloAnioLabel = [inspectorRowData?.MODELO, inspectorRowData?.ANIO]
    .map(val => (val == null ? '' : String(val).trim()))
    .filter(Boolean)
    .join(' ');
  const inspectorTallerLabel = inspectorRowData && inspectorRowData.NOMBRE_COMERCIAL_TALLER != null
    ? String(inspectorRowData.NOMBRE_COMERCIAL_TALLER).trim()
    : '';
  const inspectorOrigenLabel = inspectorRowData && inspectorRowData.ORIGEN != null
    ? String(inspectorRowData.ORIGEN).trim()
    : '';
  const inspectorValueRaw = inspectorField
    ? (inspectorRowData?.[inspectorField] ?? inspectorCell?.snapshot?.[inspectorField] ?? '')
    : '';
  const inspectorValueDisplay = inspectorValueRaw == null ? '' : String(inspectorValueRaw);
  const inspectorInstruction = inspectorCell
    ? (inspectorIsEditable
      ? 'Edita esta columna directamente en la tabla.'
      : 'Solo lectura.')
    : 'Selecciona una celda para ver su contenido.';

  const updateInspectorFromData = useCallback((field, header, data) => {
    if (!field || field === 'checked' || !data) {
      setInspectorCell(null);
      return;
    }
    const resolvedHeader = header || field;
    const rowId = data.id ?? null;
    const rowKey = buildPedidoItemKey(data.PEDIDO, data.ITEM);
    setInspectorCell({
      field,
      header: resolvedHeader,
      rowId,
      rowKey,
      snapshot: data
    });
  }, [setInspectorCell]);

  const handleCellClicked = useCallback((params) => {
    const field = params?.colDef?.field;
    const header = params?.colDef?.headerName;
    const data = params?.data || null;
    updateInspectorFromData(field, header, data);
  }, [updateInspectorFromData]);

  const handleCellFocused = useCallback((params) => {
    const column = params?.column;
    if (!column) {
      setInspectorCell(null);
      return;
    }
    const colDef = column.getColDef?.() || {};
    const field = colDef.field;
    if (!field || field === 'checked') {
      setInspectorCell(null);
      return;
    }
    const rowIndex = params?.rowIndex;
    if (typeof rowIndex !== 'number' || rowIndex < 0) {
      setInspectorCell(null);
      return;
    }
    const node = params.api?.getDisplayedRowAtIndex(rowIndex);
    const data = node?.data || null;
    updateInspectorFromData(field, colDef.headerName, data);
  }, [updateInspectorFromData, setInspectorCell]);

  const handleInspectorClear = useCallback(() => {
    setInspectorCell(null);
    const api = gridRef.current?.api;
    if (api) {
      api.clearFocusedCell();
      api.deselectAll();
    }
  }, [setInspectorCell]);

  const handleEnviarSeleccionados = async () => {
    if (!gridRef.current) return;
    const selectedRows = gridRef.current.api.getSelectedRows();
    if (selectedRows.length === 0) {
      alert('Selecciona al menos un renglón para enviar.');
      return;
    }
    const duplicadosSiniestro = [];
    const bloqueadosPedido = [];
    const clavesSiniestroSeleccionadas = new Set();
    const clavesPedidoSeleccionadas = new Set();
    const filasAEnviar = [];

    selectedRows.forEach(row => {
      const sinKey = buildSiniestroItemKey(extractSiniestro(row), extractItem(row));
      if (sinKey) {
        if (siniestroItemBaseSet.has(sinKey) || clavesSiniestroSeleccionadas.has(sinKey)) {
          duplicadosSiniestro.push(row);
        }
        clavesSiniestroSeleccionadas.add(sinKey);
      }

      const pedKey = buildPedidoItemKey(extractPedido(row), extractItem(row));
      if (pedKey) {
        if (pedidoItemBaseSet.has(pedKey) || clavesPedidoSeleccionadas.has(pedKey)) {
          bloqueadosPedido.push(row);
          return;
        }
        clavesPedidoSeleccionadas.add(pedKey);
      }

      filasAEnviar.push(row);
    });

    if (filasAEnviar.length === 0) {
      alert('Todos los seleccionados tienen PEDIDO + ITEM duplicado y no se enviaron.');
      return;
    }

    // Mapea los datos exactamente con los nombres de columnas de la base de datos
    const datosAEnviar = filasAEnviar.map(completarFila);

    console.log('Enviando a base de datos:', datosAEnviar);
    try {
  const res = await fetch(`${API_BASE_URL}/api/basedatos/insertar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datosAEnviar)
      });
      const data = await res.json();
      console.log('Respuesta del backend:', data);
      if (data.ok) {
  const ids = filasAEnviar.map(row => row.id);
  await fetch(`${API_BASE_URL}/api/excel/borrar`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });

  fetch(`${API_BASE_URL}/api/excel/obtener-excel`)
          .then(res => res.json())
          .then(data => setRowData(Array.isArray(data) ? data : []));

        window.dispatchEvent(new Event('refreshBaseDatos'));

        setParesSiniestroItemBase(prev => {
          const merged = new Set(prev);
          filasAEnviar.forEach(row => {
            const clave = buildSiniestroItemKey(extractSiniestro(row), extractItem(row));
            if (clave) {
              merged.add(clave);
            }
          });
          return Array.from(merged);
        });

        setParesPedidoItemBase(prev => {
          const merged = new Set(prev);
          filasAEnviar.forEach(row => {
            const clave = buildPedidoItemKey(extractPedido(row), extractItem(row));
            if (clave) {
              merged.add(clave);
            }
          });
          return Array.from(merged);
        });

        let mensaje = `¡Filas enviadas a base de datos y eliminadas de codificar! Total enviadas: ${filasAEnviar.length}.`;
        if (duplicadosSiniestro.length > 0) {
          mensaje += `\n\nAdvertencia: ${duplicadosSiniestro.length} fila(s) tienen SINIESTRO + ITEM duplicado. Se enviaron de todas formas:` +
            `\n` + duplicadosSiniestro.map(row => `SINIESTRO: ${row.SINIESTRO || ''} | ITEM: ${row.ITEM || ''}`).join('\n');
        }
        if (bloqueadosPedido.length > 0) {
          mensaje += `\n\nNo se enviaron ${bloqueadosPedido.length} fila(s) por PEDIDO + ITEM duplicado:` +
            `\n` + bloqueadosPedido.map(row => `PEDIDO: ${row.PEDIDO || ''} | ITEM: ${row.ITEM || ''}`).join('\n');
        }
        alert(mensaje);
      } else {
        alert(data.error || 'Error al insertar en base de datos');
      }
    } catch (err) {
      alert('Error de conexión al insertar en base de datos');
    }
  };

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (!stack.length) return;

    const entry = stack.pop();
    setCanUndo(stack.length > 0);

    if (!entry || entry.id == null || !entry.field) return;

    const api = gridRef.current?.api;
    if (!api) {
      stack.push(entry);
      setCanUndo(true);
      return;
    }

    let targetNode = api.getRowNode(String(entry.id));
    if (!targetNode) {
      api.forEachNode(node => {
        if (!targetNode && String(node.data?.id) === String(entry.id)) {
          targetNode = node;
        }
      });
    }

    if (!targetNode) {
      stack.push(entry);
      setCanUndo(true);
      return;
    }

    isApplyingUndoRef.current = true;
    targetNode.setDataValue(entry.field, entry.previousValue ?? '');
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== 'z' && event.key !== 'Z') return;
      const target = event.target;
      const tagName = (target?.tagName || '').toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;
      event.preventDefault();
      if (canUndo) {
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, canUndo]);

  const getRowClass = params => {
    const data = params.data || {};
    const clave = buildSiniestroItemKey(extractSiniestro(data), extractItem(data));
    const clases = [];

    if (clave && (siniestroItemBaseSet.has(clave) || siniestroItemDuplicadosCodificar.has(clave))) {
      clases.push('row-texto-rojo');
    }

    const pedidoClave = buildPedidoItemKey(extractPedido(data), extractItem(data));
    if (pedidoClave && (pedidoItemBaseSet.has(pedidoClave) || pedidoItemDuplicadosCodificar.has(pedidoClave))) {
      clases.push('row-pedido-duplicado');
    }

    if (data.CODIGO && data.CODIGO.trim() !== "") {
      clases.push('row-codigo-lleno');
    }

    return clases.join(' ');
  };

  const handleCellEditingStarted = params => {
    if (params.colDef.field === "CODIGO") {
      const cell = document.querySelector(
        `.ag-row[row-index="${params.node.rowIndex}"] .ag-cell[col-id="CODIGO"]`
      );
      const cellRect = cell ? cell.getBoundingClientRect() : null;
      const tooltipX = cellRect ? cellRect.right + window.scrollX + 16 : 0;
      const tooltipY = cellRect ? cellRect.top + window.scrollY + (cellRect.height / 2) : 0;

      setEditTooltip({
        show: true,
        x: tooltipX,
        y: tooltipY,
        value: `PEDIDO: ${params.data.PEDIDO || ""}
NOMBRE COMERCIAL TALLER: ${params.data.NOMBRE_COMERCIAL_TALLER || ""}
MODELO: ${params.data.MODELO || ""}
ANIO: ${params.data.ANIO || ""}
ITEM: ${params.data.ITEM || ""}`
      });
    }
  };
  const handleCellEditingStopped = params => {
    setEditTooltip({ show: false, x: 0, y: 0, value: "" });
    // NO hagas nada aquí para mover el foco
  };

  const handleLocalidadesFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      // Filtra filas vacías
      const data = XLSX.utils
        .sheet_to_json(ws, { defval: '' })
        .map(row => ({
          taller: row.taller || row.Taller || row.TALLER || '',
          localidad: row.localidad || row.Localidad || row.LOCALIDAD || row.NOMENCLATURA || '',
          codigo: row.codigo || row.CODIGO || '',
          nombreCompaq: row.nombreCompaq || row.nombre_compaq || row['NOMBRE COMPAQ'] || '',
          nomenclatura: row.nomenclatura || row.NOMENCLATURA || ''
        }))
        .filter(row => row.taller && row.localidad);
      setLocalidadesExcel(data);
    };
    reader.readAsBinaryString(file);
  };

  const handleCargarLocalidades = async () => {
    if (localidadesExcel.length === 0) return;
    try {
  const res = await fetch(`${API_BASE_URL}/api/localidades/cargar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localidadesExcel)
      });
      const data = await res.json();
      if (data.ok) {
        alert('¡Localidades cargadas correctamente!');
        // Refresca la tabla de localidades
  fetch(`${API_BASE_URL}/api/localidades`)
          .then(res => res.json())
          .then(data => setLocalidades(data));
        setLocalidadesExcel([]);
      } else {
        alert(data.error || 'Error al cargar localidades');
      }
    } catch (err) {
      alert('Error de conexión al cargar localidades');
    }
  };

  // --- NUEVO: Agregar manualmente una localidad ---
  const handleAgregarManual = async () => {
    if (!nuevaLocalidad.taller || !nuevaLocalidad.localidad) {
      alert('Completa ambos campos');
      return;
    }
    try {
  const res = await fetch(`${API_BASE_URL}/api/localidades/cargar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            taller: nuevaLocalidad.taller,
            localidad: nuevaLocalidad.localidad,
            codigo: nuevaLocalidad.codigo,
            nombreCompaq: nuevaLocalidad.nombreCompaq,
            nomenclatura: nuevaLocalidad.nomenclatura
          }
        ])
      });
      const data = await res.json();
      if (data.ok) {
        alert('¡Localidad agregada!');
  fetch(`${API_BASE_URL}/api/localidades`)
          .then(res => res.json())
          .then(data => setLocalidades(data));
        setNuevaLocalidad({
          taller: '',
          localidad: '',
          codigo: '',
          nombreCompaq: '',
          nomenclatura: ''
        });
        setAgregando(false);
      } else {
        alert(data.error || 'Error al agregar');
      }
    } catch {
      alert('Error de conexión');
    }
  };
  // --- FIN NUEVO ---

  const handleEditarLocalidad = (row) => {
    setEditando({ ...row });
    setAgregando(false);
  };

  const handleGuardarEdicion = async () => {
    if (!editando.taller || !editando.localidad) {
      alert('Completa ambos campos');
      return;
    }
    try {
  const res = await fetch(`${API_BASE_URL}/api/localidades/editar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editando)
      });
      const data = await res.json();
      if (data.ok) {
        alert('¡Localidad editada!');
  fetch(`${API_BASE_URL}/api/localidades`)
          .then(res => res.json())
          .then(data => setLocalidades(data));
        setEditando(null);
      } else {
        alert(data.error || 'Error al editar');
      }
    } catch {
      alert('Error de conexión');
    }
  };

  const handleCancelarEdicion = () => setEditando(null);

  const handleEliminarLocalidad = async (row) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta localidad?')) return;
    try {
  const res = await fetch(`${API_BASE_URL}/api/localidades/eliminar`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id })
      });
      const data = await res.json();
      if (data.ok) {
        alert('¡Localidad eliminada!');
  fetch(`${API_BASE_URL}/api/localidades`)
          .then(res => res.json())
          .then(data => setLocalidades(data));
      } else {
        alert(data.error || 'Error al eliminar');
      }
    } catch {
      alert('Error de conexión');
    }
  };

  const onLocalidadesSelectionChanged = () => {
    if (!localidadesGridRef.current) return;
    const rows = localidadesGridRef.current.api.getSelectedRows();
    setLocalidadesSeleccionadas(rows);
  };

  const handleEliminarLocalidadesSeleccionadas = async () => {
    if (!localidadesSeleccionadas.length) return;
    if (!window.confirm(`¿Seguro que deseas eliminar ${localidadesSeleccionadas.length} localidad(es)?`)) return;
    try {
      for (const row of localidadesSeleccionadas) {
  await fetch(`${API_BASE_URL}/api/localidades/eliminar`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id })
        });
      }
  fetch(`${API_BASE_URL}/api/localidades`)
        .then(res => res.json())
        .then(data => setLocalidades(data));
      if (localidadesGridRef.current) {
        localidadesGridRef.current.api.deselectAll();
      }
      setLocalidadesSeleccionadas([]);
    } catch {
      alert('Error de conexión al eliminar localidades');
    }
  };

  const AccionesRenderer = (props) => (
    <div className="inline-actions">
      <button
        type="button"
        className="btn btn-inline btn-secondary"
        onClick={() => props.onEditar(props.data)}
      >
        Editar
      </button>
      <button
        type="button"
        className="btn btn-inline btn-danger"
        onClick={() => props.onEliminar(props.data)}
      >
        Eliminar
      </button>
    </div>
  );

  const localidadesColumnDefs = [
    {
      headerName: '',
      field: 'checked',
      width: 40,
      checkboxSelection: true,
      headerCheckboxSelection: true,
      pinned: 'left'
    },
    { headerName: "Taller", field: "taller", width: 220 },
    { headerName: "Localidad", field: "localidad", width: 160 },
    { headerName: "CODIGO", field: "codigo", width: 140 },
    { headerName: "Nombre COMPAQ", field: "nombreCompaq", width: 180 },
    { headerName: "Nomenclatura", field: "nomenclatura", width: 180 },
    {
      headerName: "Acciones",
      field: "acciones",
      width: 140,
      cellRenderer: (params) => (
        <AccionesRenderer
          data={params.data}
          onEditar={handleEditarLocalidad}
          onEliminar={handleEliminarLocalidad}
        />
      )
    }
  ];

  const localidadesRowData = useMemo(() => {
    if (!Array.isArray(localidades)) return [];
    return localidades
      .filter(row => (row.taller || row.Taller) && (row.localidad || row.Localidad))
      .map(row => ({
        id: row.id,
        taller: row.taller || row.Taller || '',
        localidad: row.localidad || row.Localidad || '',
        codigo: row.codigo || row.CODIGO || '',
        nombreCompaq: row.nombreCompaq || row['NOMBRE COMPAQ'] || row.NOMBRE_COMPAQ || '',
        nomenclatura: row.nomenclatura || row.NOMENCLATURA || ''
      }));
  }, [localidades]);

  if (!(esSupervisor || esCodificar)) {
    return (
      <div className="codificar-page">
        <div className="codificar-shell codificar-denied">
          No tienes permisos para ver esta sección.
        </div>
      </div>
    );
  }

  return (
    <div className="codificar-page">
      <div className="codificar-shell">
        <div className="tab-container">
          <button
            type="button"
            className={`tab-button ${activeTab === 'principal' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('principal')}
          >
            Principal
          </button>
          {esSupervisor && (
            <button
              type="button"
              className={`tab-button ${activeTab === 'localidades' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('localidades')}
            >
              Localidades
            </button>
          )}
        </div>

        {activeTab === 'principal' && (
          <>
            <div className="top-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowColumnPanel(v => !v)}
              >
                {showColumnPanel ? 'Ocultar opciones de columnas' : 'Mostrar opciones de columnas'}
              </button>
            </div>

            <div className="section-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>
                    {inspectorHeader}
                  </div>
                  {inspectorCell ? (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          columnGap: 16,
                          rowGap: 4,
                          fontSize: 12,
                          color: '#6b7280',
                          marginTop: 4
                        }}
                      >
                        <span>
                          <span style={{ fontWeight: 600, color: '#374151' }}>Taller:</span>{' '}
                          {inspectorTallerLabel || 'Sin valor'}
                        </span>
                        <span>
                          <span style={{ fontWeight: 600, color: '#374151' }}>Modelo:</span>{' '}
                          {inspectorModeloAnioLabel || 'Sin valor'}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          columnGap: 16,
                          rowGap: 4,
                          fontSize: 12,
                          color: '#6b7280',
                          marginTop: 2
                        }}
                      >
                        <span>
                          <span style={{ fontWeight: 600, color: '#374151' }}>Pedido:</span>{' '}
                          {inspectorPedidoLabel || 'Sin valor'}
                        </span>
                        <span>
                          <span style={{ fontWeight: 600, color: '#374151' }}>Siniestro:</span>{' '}
                          {inspectorSiniestroLabel || 'Sin valor'}
                        </span>
                        <span>
                          <span style={{ fontWeight: 600, color: '#374151' }}>Origen:</span>{' '}
                          {inspectorOrigenLabel || 'Sin valor'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {inspectorInstruction}
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
                  className="btn btn-ghost"
                  onClick={handleInspectorClear}
                  disabled={!inspectorCell}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Limpiar selección
                </button>
              </div>
              {inspectorCell ? (
                <div
                  style={{
                    minHeight: 58,
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    background: '#ffffff',
                    padding: 12,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#111827'
                  }}
                >
                  {inspectorValueDisplay || '(vacío)'}
                </div>
              ) : (
                <div
                  style={{
                    minHeight: 58,
                    borderRadius: 10,
                    border: '1px dashed #d1d5db',
                    background: '#ffffff',
                    padding: 12,
                    fontSize: 12,
                    color: '#6b7280'
                  }}
                >
                  No hay una celda seleccionada.
                </div>
              )}
            </div>

            {showColumnPanel && (
              <div className="section-card column-panel">
                <strong>Mostrar/Ocultar columnas:</strong>
                <div className="column-checkboxes">
                  {columnDefs
                    .filter(col => col.field !== 'checked')
                    .map(col => (
                      <label key={col.field} className="column-checkbox">
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(col.field)}
                          onChange={() => handleColumnToggle(col.field)}
                        />
                        {col.headerName}
                      </label>
                    ))}
                </div>
              </div>
            )}

            <div className="section-card action-bar">
              <div className="metrics">
                <span className="metric metric-total">Filas: {rowData.length}</span>
                <span className="metric metric-selected">Seleccionadas: {selectedCount}</span>
              </div>
              <div className="action-controls">
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => fileInputRef.current.click()}
                >
                  Subir Excel
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleLoadData}
                  disabled={!puedeCargar}
                >
                  Cargar información
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSave}
                >
                  Guardar información
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleUndo}
                  disabled={!canUndo}
                >
                  Deshacer cambio
                </button>
                {esSupervisor && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={handleDeleteSelected}
                    disabled={selectedCount === 0}
                  >
                    Borrar seleccionados
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={handleEnviarSeleccionados}
                  disabled={selectedCount === 0}
                >
                  Enviar seleccionados a base de datos
                </button>
              </div>
            </div>

            <div className="section-card grid-card">
              <div className="ag-theme-alpine ag-grid-wrapper">
                <AgGridReact
                  ref={gridRef}
                  columnDefs={filteredColumnDefs}
                  rowData={rowData}
                  rowSelection="multiple"
                  singleClickEdit={true}
                  deltaRowDataMode={true}
                  getRowId={params => String(params.data.id)}
                  enableCellTextSelection={true}
                  suppressRowClickSelection={true}
                  domLayout="normal"
                  suppressHorizontalScroll={false}
                  suppressMovableColumns={true}
                  enableBrowserTooltips={true}
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
                  onCellValueChanged={handleCellValueChanged}
                  onCellEditingStarted={handleCellEditingStarted}
                  onCellEditingStopped={handleCellEditingStopped}
                  onCellClicked={handleCellClicked}
                  onCellFocused={handleCellFocused}
                  getRowClass={getRowClass}
                  stopEditingWhenCellsLoseFocus={true}
                  enterMovesDownAfterEdit={false}
                  enterMovesDown={false}
                  suppressClickEdit={false}
                  suppressKeyboardEvent={params => {
                    if (
                      params.editing &&
                      (params.event.key === 'Enter' || params.event.key === 'Tab') &&
                      params.column.getColId() !== "CODIGO"
                    ) {
                      return true;
                    }
                    return false;
                  }}
                />
              </div>
            </div>

            {editTooltip.show && (
              <div
                className="edit-tooltip"
                style={{ left: editTooltip.x, top: editTooltip.y }}
              >
                {editTooltip.value}
              </div>
            )}

            {esSupervisor && (
              <div className="section-card resumen-card">
                <button
                  type="button"
                  className="btn btn-primary resumen-toggle"
                  onClick={() => setMostrarResumen(prev => !prev)}
                >
                  {mostrarResumen ? 'Ocultar resumen de Siniestros y Pedidos' : 'Mostrar resumen de Siniestros y Pedidos'}
                </button>
                {mostrarResumen && (
                  <>
                    <h3 className="section-heading">Resumen de Siniestros y Pedidos</h3>
                    <div className="resumen-table-wrapper">
                      <table className="resumen-table">
                        <thead>
                          <tr>
                            <th>
                              SINIESTRO
                              <button
                                type="button"
                                className="btn-icon"
                                onClick={() => {
                                  const vistos = new Set();
                                  const texto = rowData
                                    .filter(row => {
                                      const clave = `${row.PEDIDO}|||${row.SINIESTRO}`;
                                      if (vistos.has(clave)) return false;
                                      vistos.add(clave);
                                      return true;
                                    })
                                    .map(row => (row.SINIESTRO ? row.SINIESTRO.substring(0, 11) : ''))
                                    .join('\n');
                                  navigator.clipboard.writeText(texto);
                                }}
                                title="Copiar toda la columna SINIESTRO"
                              >
                                ⧉
                              </button>
                            </th>
                            <th>
                              PEDIDO
                              <button
                                type="button"
                                className="btn-icon"
                                onClick={() => {
                                  const vistos = new Set();
                                  const texto = rowData
                                    .filter(row => {
                                      const clave = `${row.PEDIDO}|||${row.SINIESTRO}`;
                                      if (vistos.has(clave)) return false;
                                      vistos.add(clave);
                                      return true;
                                    })
                                    .map(row => (row.PEDIDO ? row.PEDIDO : ''))
                                    .join('\n');
                                  navigator.clipboard.writeText(texto);
                                }}
                                title="Copiar toda la columna PEDIDO"
                              >
                                ⧉
                              </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const vistos = new Set();
                            return rowData
                              .filter(row => {
                                const clave = `${row.PEDIDO}|||${row.SINIESTRO}`;
                                if (vistos.has(clave)) return false;
                                vistos.add(clave);
                                return true;
                              })
                              .map((row, idx) => (
                                <tr key={idx}>
                                  <td>
                                    <input
                                      type="text"
                                      value={row.SINIESTRO ? row.SINIESTRO.substring(0, 11) : ''}
                                      readOnly
                                      className="resumen-field"
                                      onClick={e => e.target.select()}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      value={row.PEDIDO ? row.PEDIDO : ''}
                                      readOnly
                                      className="resumen-field"
                                      onClick={e => e.target.select()}
                                    />
                                  </td>
                                </tr>
                              ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'localidades' && esSupervisor && (
          <div className="section-card localidades-card">
            <h2 className="section-heading">Localidades</h2>
            <div className="localidades-controls">
              <input
                type="file"
                accept=".xlsx, .xls"
                ref={localidadesFileInputRef}
                style={{ display: 'none' }}
                onChange={handleLocalidadesFileUpload}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => localidadesFileInputRef.current.click()}
              >
                Subir Excel de localidades
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCargarLocalidades}
                disabled={localidadesExcel.length === 0}
              >
                Cargar información
              </button>
              {localidadesExcel.length > 0 && (
                <span className="tag-pill success">
                  {localidadesExcel.length} filas listas para cargar
                </span>
              )}
            </div>
            <div className="localidades-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAgregando(v => !v)}
              >
                {agregando ? 'Cancelar' : 'Agregar manualmente'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleEliminarLocalidadesSeleccionadas}
                disabled={localidadesSeleccionadas.length === 0}
              >
                Borrar seleccionados
              </button>
              <span className="tag-pill info">
                Seleccionadas: {localidadesSeleccionadas.length}
              </span>
              {agregando && (
                <div className="form-inline">
                  <input
                    type="text"
                    placeholder="Taller"
                    value={nuevaLocalidad.taller}
                    onChange={e => setNuevaLocalidad({ ...nuevaLocalidad, taller: e.target.value })}
                    className="input-control"
                  />
                  <input
                    type="text"
                    placeholder="Localidad"
                    value={nuevaLocalidad.localidad}
                    onChange={e => setNuevaLocalidad({ ...nuevaLocalidad, localidad: e.target.value })}
                    className="input-control"
                  />
                  <input
                    type="text"
                    placeholder="Código"
                    value={nuevaLocalidad.codigo}
                    onChange={e => setNuevaLocalidad({ ...nuevaLocalidad, codigo: e.target.value })}
                    className="input-control"
                  />
                  <input
                    type="text"
                    placeholder="Nombre COMPAQ"
                    value={nuevaLocalidad.nombreCompaq}
                    onChange={e => setNuevaLocalidad({ ...nuevaLocalidad, nombreCompaq: e.target.value })}
                    className="input-control"
                  />
                  <input
                    type="text"
                    placeholder="Nomenclatura"
                    value={nuevaLocalidad.nomenclatura}
                    onChange={e => setNuevaLocalidad({ ...nuevaLocalidad, nomenclatura: e.target.value })}
                    className="input-control"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAgregarManual}
                  >
                    Guardar
                  </button>
                </div>
              )}
            </div>
            {editando && (
              <div className="form-inline editing-bar">
                <input
                  type="text"
                  placeholder="Taller"
                  value={editando.taller}
                  onChange={e => setEditando({ ...editando, taller: e.target.value })}
                  className="input-control"
                />
                <input
                  type="text"
                  placeholder="Localidad"
                  value={editando.localidad}
                  onChange={e => setEditando({ ...editando, localidad: e.target.value })}
                  className="input-control"
                />
                <input
                  type="text"
                  placeholder="Código"
                  value={editando.codigo || ''}
                  onChange={e => setEditando({ ...editando, codigo: e.target.value })}
                  className="input-control"
                />
                <input
                  type="text"
                  placeholder="Nombre COMPAQ"
                  value={editando.nombreCompaq || ''}
                  onChange={e => setEditando({ ...editando, nombreCompaq: e.target.value })}
                  className="input-control"
                />
                <input
                  type="text"
                  placeholder="Nomenclatura"
                  value={editando.nomenclatura || ''}
                  onChange={e => setEditando({ ...editando, nomenclatura: e.target.value })}
                  className="input-control"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleGuardarEdicion}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleCancelarEdicion}
                >
                  Cancelar
                </button>
              </div>
            )}
            <div className="ag-theme-alpine ag-grid-wrapper small-grid">
              <AgGridReact
                ref={localidadesGridRef}
                columnDefs={localidadesColumnDefs}
                rowData={localidadesRowData}
                domLayout="normal"
                defaultColDef={{
                  resizable: true,
                  sortable: true,
                  filter: true,
                }}
                rowSelection="multiple"
                onSelectionChanged={onLocalidadesSelectionChanged}
                suppressRowClickSelection={true}
                getRowId={params => String(params.data.id)}
                deltaRowDataMode={true}
                headerHeight={32}
                rowHeight={28}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const columnasBaseDatos = [
  "ASEGURADORA", "COTIZACION", "PEDIDO", "FECHA_COTIZACION", "FECHA_PEDIDO", "PROMESA_DE_ENTREGA",
  "FECHA_CONFIRMACION_DE_PIEZA", "FECHA_CANCELACION_DE_PIEZA", "FECHA_FACTURACION_DE_PIEZA",
  "FECHA_ENTREGA_DE_PIEZA", "FECHA_RECEPCION_DE_PIEZA", "DIAS_PROMESA", "DIAS_ENTREGADO1",
  "DIAS_ENTREGADO2", "DIAS_RECIBIDO1", "DIAS_RECIBIDO2", "SINIESTRO", "NOMBRE_COMERCIAL_TALLER",
  "CIUDAD_TALLER", "ESTADO_TALLER", "NOMBRE_CONTACTO", "TELEFONO", "EMAIL", "ARMADORA", "MODELO",
  "ANIO", "RFC_PROVEEDOR", "RAZON_SOCIAL_PROVEEDOR", "NOMBRE_COMERCIAL_PROVEEDOR", "COLUMNA1",
  "ESTADO_PROVEEDOR", "ITEM", "ORIGEN", "PRECIO", "ESTATUS", "BACK_ORDER", "CODIGO", "COSTO",
  "LOCALIDAD", "CHOFER", "COMPAQ", "OC", "NUEVO_ESTATUS", "ESTATUS_LOCAL", "ESTATUS_FORANEO", "ESTATUS2"
];

const completarFila = (row) => {
  const nueva = {};
  columnasBaseDatos.forEach(col => {
    nueva[col] = row[col] !== undefined ? row[col] : "";
  });
  return nueva;
};

export default CodificarPage;