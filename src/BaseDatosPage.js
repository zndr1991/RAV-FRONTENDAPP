import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io as socketIOClient } from 'socket.io-client';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import * as XLSX from 'xlsx';
import { baseColumnDefs as baseDatosColumnDefs, parseFechaPedido } from './baseDatosColumns';
import { API_BASE_URL, SOCKET_URL } from './config';

ModuleRegistry.registerModules([AllCommunityModule]);

const ordenesColumnDefs = [
  { headerName: '', field: 'checked', checkboxSelection: true, headerCheckboxSelection: true, width: 30, pinned: 'left' },
  { headerName: 'PEDIDO', field: 'PEDIDO', flex: 1, minWidth: 160 },
  { headerName: 'ORDEN PROVEEDOR', field: 'ORDEN_PROVEEDOR', flex: 1.2, minWidth: 200 }
];

const BaseDatosPage = () => {
  const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
  const esSupervisor = usuario.role === 'supervisor';

  const [rowData, setRowData] = useState([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState('contiene');
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('baseDatosTab') || 'principal');
  const [ordenesData, setOrdenesData] = useState([]);
  const [ordenesSelectedCount, setOrdenesSelectedCount] = useState(0);
  const [searchOrdenText, setSearchOrdenText] = useState('');
  const [ordenesExcelData, setOrdenesExcelData] = useState([]);
  const [ordenesPuedeCargar, setOrdenesPuedeCargar] = useState(false);
  const gridRef = useRef();
  const ordenesGridRef = useRef();
  const ordenesFileInputRef = useRef();
  const columnDefs = useMemo(
    () => baseDatosColumnDefs.map(column => ({ ...column })),
    []
  );

  const cargarDatos = useCallback(() => {
    fetch(`${API_BASE_URL}/api/basedatos/obtener`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) {
          setRowData([]);
          return;
        }
        const sorted = [...data].sort((a, b) => {
          const fechaA = parseFechaPedido(a.FECHA_PEDIDO);
          const fechaB = parseFechaPedido(b.FECHA_PEDIDO);
          return fechaB - fechaA;
        });
        setRowData(sorted);
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
    const refrescar = () => cargarDatos();
    const refrescarOrdenes = () => cargarOrdenes();
    window.addEventListener('refreshBaseDatos', refrescar);
    window.addEventListener('refreshOrdenesProveedor', refrescarOrdenes);

    // --- SOCKET.IO ---
  const socket = socketIOClient(SOCKET_URL);
    socket.on('excel_data_updated', () => {
      cargarDatos();
      cargarOrdenes();
    });

    return () => {
      window.removeEventListener('refreshBaseDatos', refrescar);
      window.removeEventListener('refreshOrdenesProveedor', refrescarOrdenes);
      socket.disconnect();
    };
  }, [cargarDatos, cargarOrdenes]);

  useEffect(() => {
    localStorage.setItem('baseDatosTab', activeTab);
  }, [activeTab]);

  const filteredDataMemo = useMemo(() => {
    if (!searchText) return rowData;
    const lower = searchText.toLowerCase();
    return rowData.filter(row =>
      Object.values(row).some(val => {
        if (typeof val !== 'string' && typeof val !== 'number') return false;
        const cell = String(val).toLowerCase();
        return searchType === 'exacta' ? cell === lower : cell.includes(lower);
      })
    );
  }, [rowData, searchText, searchType]);

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

  const onOrdenSelectionChanged = () => {
    if (ordenesGridRef.current) {
      const selectedRows = ordenesGridRef.current.api.getSelectedRows();
      setOrdenesSelectedCount(selectedRows.length);
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
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
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
          </div>
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
              columnDefs={columnDefs}
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