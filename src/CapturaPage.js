import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { io as socketIOClient } from 'socket.io-client';
import * as XLSX from 'xlsx';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import './CapturaPage.css';
import { baseColumnDefs, parseFechaPedido } from './baseDatosColumns';
import { API_BASE_URL, SOCKET_URL } from './config';

ModuleRegistry.registerModules([AllCommunityModule]);

const normalizarTaller = (valor) => {
  if (!valor) return '';
  return valor.toString().trim().toLowerCase().replace(/\s+/g, ' ');
};

const parseCostoToNumber = (raw) => {
  if (raw === null || raw === undefined || raw === '') return NaN;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '').trim();
  if (cleaned === '') return NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const resolveCodigoPorCosto = (row) => {
  const numeric = parseCostoToNumber(row.COSTO);
  if (Number.isFinite(numeric) && numeric > 1) {
    return 'GDL002';
  }
  return 'GDL005';
};

const buildFolioConSufijo = (pedido, esAjustado) => {
  if (!pedido) return '';
  if (esAjustado) {
    return `${pedido}031`;
  }
  return `${pedido}03`;
};

const expandRowByCodigo = (row, valueField = 'COSTO') => {
  const codigoRaw = row.CODIGO;
  const costoRaw = row[valueField];
  const splitCodigo = typeof codigoRaw === 'string' && codigoRaw.includes('/');
  const splitCosto = typeof costoRaw === 'string' && costoRaw.includes('/');
  if (!splitCodigo && !splitCosto) {
    return [{ ...row }];
  }
  const codigoParts = splitCodigo
    ? codigoRaw.split('/').map(part => part.trim()).filter(part => part !== '')
    : [codigoRaw];
  const costoParts = splitCosto
    ? costoRaw.split('/').map(part => part.trim()).filter(part => part !== '')
    : [costoRaw];
  const fallbackCodigo = codigoParts.length ? codigoParts[codigoParts.length - 1] : '';
  const fallbackCosto = costoParts.length ? costoParts[costoParts.length - 1] : '';
  const iterations = Math.max(codigoParts.length, costoParts.length, 1);
  return Array.from({ length: iterations }).map((_, idx) => ({
    ...row,
    CODIGO: codigoParts[idx] !== undefined ? codigoParts[idx] : fallbackCodigo,
    [valueField]: costoParts[idx] !== undefined ? costoParts[idx] : fallbackCosto,
  }));
};

const resolveCostoConDefault = (row) => {
  const numeric = parseCostoToNumber(row.COSTO);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return 1;
};

const resolvePrecioConDefault = (row) => {
  const numeric = parseCostoToNumber(row.PRECIO);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return 1;
};

const pedidoTemplateColumns = [
  { header: 'Generado', valueGetter: () => '' },
  { header: 'Bitacora', valueGetter: () => '' },
  {
    header: 'Folio',
    valueGetter: (row) => (row.PEDIDO ?? '').toString().trim(),
  },
  {
    header: 'Serie',
    valueGetter: (row) => (row.__serieNomenclatura || ''),
  },
  {
    header: 'Fecha',
    valueGetter: (row) => {
      const raw = row.FECHA_PEDIDO;
      if (!raw) return '';
      const parsed = parseFechaPedido(raw);
      if (Number.isNaN(parsed.getTime())) return '';
      return parsed.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    },
  },
  {
    header: 'CteProv',
    valueGetter: (row) => (row.__cteProv || ''),
  },
  { header: 'RazonSocial', valueGetter: () => '' },
  {
    header: 'Taller',
    valueGetter: (row) => (row.NOMBRE_COMERCIAL_TALLER || '').toString().trim(),
  },
  { header: 'Agente', valueGetter: () => '' },
  {
    header: 'Referencia',
    valueGetter: (row) => {
      const aseguradora = (row.ASEGURADORA || '').trim().toUpperCase();
      const siniestro = (row.SINIESTRO || '').toString().trim();
      if (!siniestro) return '';
      if (aseguradora === 'CHUBB SEGUROS MEXICO / CHUBB SEGUROS MEXICO') {
        return siniestro.slice(0, 11);
      }
      return '';
    },
  },
  {
    header: 'Carro',
    valueGetter: (row) => {
      const modelo = (row.MODELO || '').toString().trim();
      const anio = row.ANIO !== undefined && row.ANIO !== null ? String(row.ANIO).trim() : '';
      if (modelo && anio) return `${modelo} ${anio}`;
      if (modelo) return modelo;
      if (anio) return anio;
      return '';
    },
  },
  {
    header: 'Taller2',
    valueGetter: (row) => (row.NOMBRE_COMERCIAL_TALLER || '').toString().trim(),
  },
  {
    header: 'Orden',
    valueGetter: (row) => (row.OC || '').toString().trim(),
  },
  {
    header: 'Codigo3',
    valueGetter: (row) => (row.CODIGO || '').toString().trim(),
  },
  {
    header: 'NombreProducto',
    valueGetter: (row) => (row.ITEM || '').toString().trim(),
  },
  { header: 'Almacen', valueGetter: () => '999' },
  { header: 'Cantidad', valueGetter: () => '1' },
  {
    header: 'Precio',
    valueGetter: (row) => resolvePrecioConDefault(row),
    format: 'currency',
  },
  {
    header: 'Columna1',
    valueGetter: (row) => resolvePrecioConDefault(row),
    format: 'currency',
  },
];

const compraTemplateColumns = [
  { header: '', valueGetter: () => '' },
  { header: 'Generado', valueGetter: () => '' },
  { header: 'Bitacora', valueGetter: () => '' },
  {
    header: 'Folio',
    valueGetter: (row) => {
      const pedido = row.PEDIDO ?? '';
      if (row.__folioAjustado) {
        return row.__folioAjustado;
      }
      return buildFolioConSufijo(pedido, false);
    },
  },
  { header: 'Serie', valueGetter: () => 'RAV' },
  { header: 'Fecha', valueGetter: () => '' },
  {
    header: 'Fecha 2',
    valueGetter: (row) => {
      const raw = row.FECHA_PEDIDO;
      if (!raw) return '';
      const parsed = parseFechaPedido(raw);
      if (Number.isNaN(parsed.getTime())) return '';
      return parsed.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    },
  },
  {
    header: 'Codigo',
    valueGetter: (row) => resolveCodigoPorCosto(row),
  },
  { header: 'Taller', valueGetter: () => '' },
  { header: 'Agente', valueGetter: () => '' },
  {
    header: 'Referencia',
    valueGetter: (row) => {
      const aseguradora = (row.ASEGURADORA || '').trim().toUpperCase();
      const siniestro = (row.SINIESTRO || '').trim();
      if (!siniestro) return '';
      if (aseguradora === 'CHUBB SEGUROS MEXICO / CHUBB SEGUROS MEXICO') {
        return siniestro.slice(0, 11);
      }
      return siniestro;
    }
  },
  {
    header: 'Carro',
    valueGetter: (row) => {
      const modelo = (row.MODELO || '').toString().trim();
      const anio = row.ANIO !== undefined && row.ANIO !== null ? String(row.ANIO).trim() : '';
      if (modelo && anio) return `${modelo} ${anio}`;
      if (modelo) return modelo;
      if (anio) return anio;
      return '';
    }
  },
  {
    header: 'Taller2',
    valueGetter: (row) => (row.NOMBRE_COMERCIAL_TALLER || '').toString().trim(),
  },
  {
    header: 'Orden',
    valueGetter: (row) => (row.OC || '').toString().trim(),
  },
  {
    header: 'Codigo3',
    valueGetter: (row) => (row.CODIGO || '').toString().trim(),
  },
  {
    header: 'NombreProducto',
    valueGetter: (row) => (row.ITEM || '').toString().trim(),
  },
  {
    header: 'Almacen',
    valueGetter: () => '999',
  },
  {
    header: 'Cantidad',
    valueGetter: () => '1',
  },
  {
    header: 'Precio',
    valueGetter: (row) => resolveCostoConDefault(row),
    format: 'currency',
  },
  {
    header: 'Columna1',
    valueGetter: (row) => resolveCostoConDefault(row),
    format: 'currency',
  },
];

const checklistItems = [
  { id: 1, titulo: 'Recepción de pedido', descripcion: 'Verifica folio, piezas y documentación antes de iniciar la captura.' },
  { id: 2, titulo: 'Validación de datos', descripcion: 'Confirma datos del cliente, VIN y combinación de pedido/OC.' },
  { id: 3, titulo: 'Evidencia digital', descripcion: 'Adjunta fotografías o facturas cuando el proceso lo requiera.' },
];

const quickLinks = [
  { id: 'formatos', titulo: 'Formatos de captura', descripcion: 'Plantillas vigentes para entregar reportes diarios.' },
  { id: 'lineamientos', titulo: 'Lineamientos', descripcion: 'Criterios de validación y políticas de calidad.' },
  { id: 'faq', titulo: 'Preguntas frecuentes', descripcion: 'Solución rápida a incidencias comunes.' },
];

function CapturaPage() {
  const [rowData, setRowData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [marking, setMarking] = useState(false);
  const [localidades, setLocalidades] = useState([]);
  const gridRef = useRef(null);
  const usuario = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('usuario') || '{}');
    } catch (err) {
      return {};
    }
  }, []);

  const rol = (usuario.role || '').toLowerCase();
  const puedeVer = rol === 'supervisor' || rol === 'captura';

  const columnDefs = useMemo(
    () => baseColumnDefs.map(column => ({ ...column })),
    []
  );

  const defaultColDef = useMemo(
    () => ({
      resizable: true,
      sortable: true,
      filter: false,
      minWidth: 40,
      editable: false,
    }),
    []
  );

  const localeText = useMemo(
    () => ({
      noRowsToShow: loading ? 'Cargando datos…' : 'Sin pedidos con estado GENERAR',
    }),
    [loading]
  );

  const localidadesMap = useMemo(() => {
    const diccionario = new Map();
    if (Array.isArray(localidades)) {
      localidades.forEach((loc) => {
        const tallerValor = loc.taller ?? loc.TALLER ?? loc['NOMBRE COMERCIAL TALLER'] ?? '';
        const codigoValor = loc.CODIGO ?? loc.codigo ?? '';
        const nomenclaturaValor = loc.NOMENCLATURA ?? loc.nomenclatura ?? '';
        const key = normalizarTaller(tallerValor);
        if (key) {
          const codigoStr = codigoValor !== null && codigoValor !== undefined && codigoValor !== ''
            ? codigoValor.toString().trim()
            : '';
          const nomenclaturaStr = nomenclaturaValor !== null && nomenclaturaValor !== undefined && nomenclaturaValor !== ''
            ? nomenclaturaValor.toString().trim()
            : '';
          diccionario.set(key, { codigo: codigoStr, nomenclatura: nomenclaturaStr });
        }
      });
    }
    return diccionario;
  }, [localidades]);

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
  const res = await fetch(`${API_BASE_URL}/api/basedatos/captura/generar`);
      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        setRowData([]);
        setLastUpdated(new Date());
        return;
      }
      const sorted = [...data].sort((a, b) => {
        const fechaA = parseFechaPedido(a.FECHA_PEDIDO);
        const fechaB = parseFechaPedido(b.FECHA_PEDIDO);
        return fechaB - fechaA;
      });
      setRowData(sorted);
      if (gridRef.current) {
        gridRef.current.api.deselectAll();
      }
      setSelectedCount(0);
      setLastUpdated(new Date());
    } catch (err) {
      setRowData([]);
      setError('No se pudo cargar la información. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (puedeVer) {
      cargarDatos();
    }
  }, [cargarDatos, puedeVer]);

  useEffect(() => {
    let cancelado = false;
    const cargarLocalidades = async () => {
      try {
  const res = await fetch(`${API_BASE_URL}/api/localidades`);
        if (!res.ok) {
          throw new Error(`Error ${res.status}`);
        }
        const data = await res.json();
        if (!cancelado) {
          setLocalidades(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelado) {
          setLocalidades([]);
        }
      }
    };
    cargarLocalidades();
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    if (!puedeVer) return undefined;
  const socket = socketIOClient(SOCKET_URL);
    const refrescar = () => cargarDatos();
    socket.on('excel_data_updated', refrescar);
    return () => {
      socket.off('excel_data_updated', refrescar);
      socket.disconnect();
    };
  }, [cargarDatos, puedeVer]);

  const handleSelectionChanged = useCallback(() => {
    if (!gridRef.current) return;
    const selectedRows = gridRef.current.api.getSelectedRows();
    setSelectedCount(selectedRows.length);
  }, []);

  const handleMarkAsGenerated = useCallback(async () => {
    if (!gridRef.current || marking || loading) return;
    const selectedRows = gridRef.current.api.getSelectedRows();
    const ids = selectedRows.map(row => row.id).filter(Boolean);
    if (!ids.length) {
      alert('Selecciona al menos un pedido para marcar como GENERADO.');
      return;
    }
    setMarking(true);
    setError('');
    try {
  const res = await fetch(`${API_BASE_URL}/api/basedatos/captura/marcar-generado`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }
      const data = await res.json();
      if (!data || data.ok === false) {
        throw new Error(data?.mensaje || 'No se pudo actualizar.');
      }
      gridRef.current.api.deselectAll();
      setSelectedCount(0);
      await cargarDatos();
    } catch (err) {
      setError('No se pudo marcar como GENERADO. Intenta nuevamente.');
    } finally {
      setMarking(false);
    }
  }, [cargarDatos, loading, marking]);

  const prepareCompraRows = useCallback(() => {
    const rows = rowData.flatMap((row, index) => (
      expandRowByCodigo(row).map((expandedRow, splitIndex) => ({
        ...expandedRow,
        __originalIndex: index,
        __splitIndex: splitIndex,
      }))
    ));
    const pedidoCount = new Map();
    rows.forEach((row) => {
      const pedidoKey = (row.PEDIDO ?? '').toString().trim();
      if (!pedidoKey) return;
      pedidoCount.set(pedidoKey, (pedidoCount.get(pedidoKey) || 0) + 1);
    });
    rows.forEach((row) => {
      const pedidoKey = (row.PEDIDO ?? '').toString().trim();
      const codigo = resolveCodigoPorCosto(row);
      const count = pedidoKey ? pedidoCount.get(pedidoKey) || 0 : 0;
      const shouldAppend = Boolean(pedidoKey) && codigo === 'GDL005' && count > 1;
      const folioBase = buildFolioConSufijo(pedidoKey, shouldAppend);
      row.__folioAjustado = folioBase;
      row.__folioAjustadoFlag = shouldAppend;
      row.__pedidoClave = pedidoKey;
    });
    const grouped = new Map();
    rows.forEach((row) => {
      const key = row.__pedidoClave ?? '';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(row);
    });
    const ordered = [];
    grouped.forEach((groupRows) => {
      const sinAjuste = groupRows
        .filter(r => !r.__folioAjustadoFlag)
        .sort((a, b) => a.__originalIndex - b.__originalIndex);
      const conAjuste = groupRows
        .filter(r => r.__folioAjustadoFlag)
        .sort((a, b) => a.__originalIndex - b.__originalIndex);
      ordered.push(...sinAjuste, ...conAjuste);
    });
    return ordered;
  }, [rowData]);

  const preparePedidoRows = useCallback(() => (
    rowData.map((row) => {
      if (!row) return row;
      const clone = { ...row };
      if (typeof clone.CODIGO === 'string' && clone.CODIGO.includes('/')) {
        const [primeroCodigo] = clone.CODIGO.split('/').map(part => part.trim()).filter(Boolean);
        clone.CODIGO = primeroCodigo ?? '';
      }
      if (typeof clone.PRECIO === 'string' && clone.PRECIO.includes('/')) {
        const [primeroPrecio] = clone.PRECIO.split('/').map(part => part.trim()).filter(Boolean);
        clone.PRECIO = primeroPrecio ?? '';
      }
      const tallerKey = normalizarTaller(clone.NOMBRE_COMERCIAL_TALLER || '');
      if (tallerKey) {
        const localidadInfo = localidadesMap.get(tallerKey) || {};
        clone.__cteProv = localidadInfo.codigo || '';
        clone.__serieNomenclatura = localidadInfo.nomenclatura || '';
      } else {
        clone.__cteProv = '';
        clone.__serieNomenclatura = '';
      }
      return clone;
    })
  ), [rowData, localidadesMap]);

  const buildTemplateData = useCallback((columns, customRows) => {
    const sourceRows = customRows || rowData;
    return sourceRows.map(row => (
      columns.map(col => {
        if (typeof col.valueGetter === 'function') {
          return col.valueGetter(row);
        }
        if (col.field) {
          const value = row[col.field];
          return value === null || value === undefined ? '' : value;
        }
        return '';
      })
    ));
  }, [rowData]);

  const downloadTemplate = useCallback((columns, fileLabel, sourceRows) => {
    if (!sourceRows.length) {
      alert('No hay registros pendientes para generar la plantilla.');
      return;
    }
    let rows;
    if (columns === compraTemplateColumns) {
      rows = prepareCompraRows();
    } else if (columns === pedidoTemplateColumns) {
      rows = preparePedidoRows();
    } else {
      rows = sourceRows;
    }
    const data = buildTemplateData(columns, rows);
    const headers = columns.map(col => col.header);
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    columns.forEach((col, colIdx) => {
      if (col.format === 'currency') {
        for (let rowIdx = 1; rowIdx <= data.length; rowIdx += 1) {
          const cellAddress = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
          const existingCell = worksheet[cellAddress];
          const rawValue = existingCell?.v;
          const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
          const value = Number.isFinite(numericValue) ? numericValue : 1;
          worksheet[cellAddress] = { t: 'n', v: value, z: '$#,##0.00' };
        }
      }
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pendientes');
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '').slice(0, 15);
    XLSX.writeFile(workbook, `Plantilla_${fileLabel}_${timestamp}.xlsx`);
  }, [buildTemplateData, prepareCompraRows, preparePedidoRows]);

  if (!puedeVer) {
    return (
      <div className="captura-denied">
        <div className="captura-denied__card">
          <h2>Acceso restringido</h2>
          <p>No cuentas con permisos para ingresar al módulo de captura.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="captura-page">
      <section className="captura-card">
        <div className="captura-card__header">
          <div>
            <h2 className="captura-card__title">Centro de Captura</h2>
            <p className="captura-card__subtitle">
              Consolida pedidos, actualiza evidencia y mantén la información lista para auditorías.
            </p>
          </div>
          <div className="captura-pill">Rol: {usuario.role}</div>
        </div>
        <div className="captura-grid">
          <article className="captura-panel">
            <header className="captura-panel__header">
              <h3>Checklist operativo</h3>
              <span className="captura-tag">3 pasos</span>
            </header>
            <ul className="captura-list">
              {checklistItems.map(item => (
                <li key={item.id}>
                  <h4>{item.titulo}</h4>
                  <p>{item.descripcion}</p>
                </li>
              ))}
            </ul>
          </article>
          <article className="captura-panel">
            <header className="captura-panel__header">
              <h3>Atajos rápidos</h3>
              <span className="captura-tag captura-tag--muted">Recursos guía</span>
            </header>
            <div className="captura-links">
              {quickLinks.map(link => (
                <button key={link.id} type="button">
                  <strong>{link.titulo}</strong>
                  <span>{link.descripcion}</span>
                </button>
              ))}
            </div>
          </article>
        </div>
      </section>
      <section className="captura-card captura-table-card">
        <header className="captura-card__header captura-table-header">
          <div>
            <h3 className="captura-card__title captura-card__title--small">Pedidos pendientes por capturar</h3>
            <p className="captura-card__subtitle">
              Filtrados automáticamente mostrando únicamente registros donde COMPAQ es GENERAR.
            </p>
          </div>
          <div className="captura-table-actions">
            <span className="captura-selection">Seleccionados: {selectedCount}</span>
            <button
              type="button"
              className="captura-refresh"
              onClick={cargarDatos}
              disabled={loading}
            >
              {loading ? 'Cargando…' : 'Actualizar'}
            </button>
            <button
              type="button"
              className="captura-template captura-template--pedido"
              onClick={() => downloadTemplate(pedidoTemplateColumns, 'Pedido', rowData)}
              disabled={loading || marking || !rowData.length}
            >
              Plantilla Pedido
            </button>
            <button
              type="button"
              className="captura-template captura-template--compra"
              onClick={() => downloadTemplate(compraTemplateColumns, 'Compra', rowData)}
              disabled={loading || marking || !rowData.length}
            >
              Plantilla Compra
            </button>
            <button
              type="button"
              className="captura-mark"
              onClick={handleMarkAsGenerated}
              disabled={loading || marking || selectedCount === 0}
            >
              GENERADO
            </button>
          </div>
        </header>
        {error && <div className="captura-alert">{error}</div>}
        <div className="captura-grid-wrapper">
          <div className="ag-theme-alpine captura-grid-table">
            <AgGridReact
              ref={gridRef}
              columnDefs={columnDefs}
              rowData={rowData}
              defaultColDef={defaultColDef}
              rowSelection="multiple"
              domLayout="normal"
              suppressMovableColumns={true}
              suppressHorizontalScroll={false}
              enableCellTextSelection={true}
              enableBrowserTooltips={true}
              headerHeight={32}
              rowHeight={28}
              localeText={localeText}
              onSelectionChanged={handleSelectionChanged}
            />
          </div>
        </div>
      </section>
      <section className="captura-card captura-card--secondary">
        <header className="captura-card__header">
          <div>
            <h3 className="captura-card__title captura-card__title--small">Resumen del día</h3>
            <p className="captura-card__subtitle">
              Mantén el equipo informado. Solicita evidencias faltantes y comparte actualizaciones en tiempo real.
            </p>
          </div>
        </header>
        <div className="captura-summary">
          <div className="captura-summary__item">
            <span className="captura-summary__label">Pedidos pendientes</span>
            <span className="captura-summary__value">{loading ? '…' : rowData.length}</span>
          </div>
          <div className="captura-summary__item">
            <span className="captura-summary__label">Evidencias por revisar</span>
            <span className="captura-summary__value">—</span>
          </div>
          <div className="captura-summary__item">
            <span className="captura-summary__label">Última actualización</span>
            <span className="captura-summary__value">
              {lastUpdated
                ? lastUpdated.toLocaleString('es-MX', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })
                : 'Sin datos'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CapturaPage;
