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

export function parseFechaDDMMYYYY(fechaStr) {
  if (!fechaStr) return null;
  const [fecha, hora] = fechaStr.split(' ');
  if (!fecha) return null;
  const [dia, mes, anio] = fecha.split('/');
  if (!dia || !mes || !anio) return null;
  let h = 0;
  let m = 0;
  let s = 0;
  if (hora) {
    [h, m, s] = hora.split(':').map(Number);
  }
  return new Date(Number(anio), Number(mes) - 1, Number(dia), h, m, s);
}

export const formatFecha = (params) => {
  if (!params.value) return '';
  if (typeof params.value === 'string' && params.value.match(/^\d{2}\/\d{2}\/\d{4}/)) {
    const date = parseFechaDDMMYYYY(params.value);
    if (date && !isNaN(date.getTime())) {
      return (
        date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      );
    }
  }
  let value = params.value;
  if (typeof value === 'string' && !isNaN(value) && value.trim() !== '') {
    value = Number(value);
  }
  if (typeof value === 'number' && !isNaN(value)) {
    const date = excelDateToJSDate(value);
    if (!isNaN(date.getTime())) {
      return (
        date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      );
    }
  }
  const date = new Date(params.value);
  if (!isNaN(date.getTime())) {
    return (
      date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' +
      date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    );
  }
  return params.value;
};

export function parseFechaPedido(fechaStr) {
  if (!fechaStr) return new Date('1900-01-01');
  const [fecha, hora] = fechaStr.split(' ');
  if (!fecha) return new Date('1900-01-01');
  const [dia, mes, anio] = fecha.split('/');
  if (!dia || !mes || !anio) return new Date('1900-01-01');
  let h = 0;
  let m = 0;
  let s = 0;
  if (hora) {
    [h, m, s] = hora.split(':').map(Number);
  }
  return new Date(Number(anio), Number(mes) - 1, Number(dia), h, m, s);
}

export const promesaRowClassRules = {
  'promesa-roja': (params) => {
    const promesa = parseFechaPedido(params?.data?.PROMESA_DE_ENTREGA);
    if (!(promesa instanceof Date) || Number.isNaN(promesa.getTime())) return false;
    const today = new Date();
    return promesa < startOfToday(today);
  },
  'promesa-naranja': (params) => {
    const promesa = parseFechaPedido(params?.data?.PROMESA_DE_ENTREGA);
    if (!(promesa instanceof Date) || Number.isNaN(promesa.getTime())) return false;
    const today = new Date();
    return promesa >= startOfToday(today) && promesa <= endOfToday(today);
  },
  'promesa-verde': (params) => {
    const promesa = parseFechaPedido(params?.data?.PROMESA_DE_ENTREGA);
    if (!(promesa instanceof Date) || Number.isNaN(promesa.getTime())) return false;
    const today = new Date();
    return promesa > endOfToday(today);
  }
};

function startOfToday(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfToday(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

const statusTooltipValueGetter = (field) => (params) => {
  const data = params?.data || {};
  const value = data[field];
  return value == null ? '' : String(value);
};

export const baseColumnDefs = [
  { headerName: '', field: 'checked', checkboxSelection: true, headerCheckboxSelection: true, width: 30, pinned: 'left' },
  { headerName: 'ASEGURADORA', field: 'ASEGURADORA', width: 180 },
  { headerName: 'COTIZACION', field: 'COTIZACION', width: 120 },
  { headerName: 'PEDIDO', field: 'PEDIDO', width: 120 },
  { headerName: 'FECHA COTIZACION', field: 'FECHA_COTIZACION', width: 160, valueFormatter: formatFecha },
  { headerName: 'FECHA PEDIDO', field: 'FECHA_PEDIDO', width: 180, valueFormatter: formatFecha },
  { headerName: 'PROMESA DE ENTREGA', field: 'PROMESA_DE_ENTREGA', width: 150, valueFormatter: formatFecha },
  { headerName: 'FECHA CONFIRMACION DE PIEZA', field: 'FECHA_CONFIRMACION_DE_PIEZA', width: 180, valueFormatter: formatFecha },
  { headerName: 'FECHA CANCELACION DE PIEZA', field: 'FECHA_CANCELACION_DE_PIEZA', width: 180, valueFormatter: formatFecha },
  { headerName: 'FECHA FACTURACION DE PIEZA', field: 'FECHA_FACTURACION_DE_PIEZA', width: 180, valueFormatter: formatFecha },
  { headerName: 'FECHA ENTREGA DE PIEZA', field: 'FECHA_ENTREGA_DE_PIEZA', width: 180, valueFormatter: formatFecha },
  { headerName: 'FECHA RECEPCION DE PIEZA', field: 'FECHA_RECEPCION_DE_PIEZA', width: 180, valueFormatter: formatFecha },
  { headerName: 'DIAS PROMESA', field: 'DIAS_PROMESA', width: 120 },
  { headerName: 'DIAS ENTREGADO1', field: 'DIAS_ENTREGADO1', width: 220 },
  { headerName: 'DIAS ENTREGADO2', field: 'DIAS_ENTREGADO2', width: 250 },
  { headerName: 'DIAS RECIBIDO1', field: 'DIAS_RECIBIDO1', width: 220 },
  { headerName: 'DIAS RECIBIDO2', field: 'DIAS_RECIBIDO2', width: 220 },
  { headerName: 'SINIESTRO', field: 'SINIESTRO', width: 180 },
  { headerName: 'NOMBRE COMERCIAL TALLER', field: 'NOMBRE_COMERCIAL_TALLER', width: 250 },
  { headerName: 'CIUDAD TALLER', field: 'CIUDAD_TALLER', width: 150 },
  { headerName: 'ESTADO TALLER', field: 'ESTADO_TALLER', width: 150 },
  { headerName: 'NOMBRE CONTACTO', field: 'NOMBRE_CONTACTO', width: 180 },
  { headerName: 'TELEFONO', field: 'TELEFONO', width: 130 },
  { headerName: 'EMAIL', field: 'EMAIL', width: 200 },
  { headerName: 'ARMADORA', field: 'ARMADORA', width: 120 },
  { headerName: 'MODELO', field: 'MODELO', width: 180 },
  { headerName: 'ANIO', field: 'ANIO', width: 80 },
  { headerName: 'RFC PROVEEDOR', field: 'RFC_PROVEEDOR', width: 150 },
  { headerName: 'RAZON SOCIAL PROVEEDOR', field: 'RAZON_SOCIAL_PROVEEDOR', width: 200 },
  { headerName: 'NOMBRE COMERCIAL PROVEEDOR', field: 'NOMBRE_COMERCIAL_PROVEEDOR', width: 200 },
  { headerName: 'COLUMNA1', field: 'COLUMNA1', width: 120 },
  { headerName: 'ESTADO PROVEEDOR', field: 'ESTADO_PROVEEDOR', width: 150 },
  { headerName: 'ITEM', field: 'ITEM', width: 180 },
  { headerName: 'ORIGEN', field: 'ORIGEN', width: 100 },
  { headerName: 'PRECIO', field: 'PRECIO', width: 90 },
  { headerName: 'ESTATUS', field: 'ESTATUS', width: 120 },
  { headerName: 'BACK ORDER', field: 'BACK_ORDER', width: 120 },
  { headerName: 'CODIGO', field: 'CODIGO', width: 120 },
  { headerName: 'COSTO', field: 'COSTO', width: 100 },
  { headerName: 'LOCALIDAD', field: 'LOCALIDAD', width: 150 },
  { headerName: 'CHOFER', field: 'CHOFER', width: 120 },
  { headerName: 'COMPAQ', field: 'COMPAQ', width: 120 },
  { headerName: 'OC', field: 'OC', width: 100 },
  { headerName: 'NUEVO ESTATUS', field: 'NUEVO_ESTATUS', width: 150 },
  {
    headerName: 'ESTATUS LOCAL',
    field: 'ESTATUS_LOCAL',
    width: 150,
    tooltipValueGetter: statusTooltipValueGetter('ESTATUS_LOCAL')
  },
  {
    headerName: 'ESTATUS FORANEO',
    field: 'ESTATUS_FORANEO',
    width: 150,
    tooltipValueGetter: statusTooltipValueGetter('ESTATUS_FORANEO')
  },
  {
    headerName: 'ESTATUS2',
    field: 'ESTATUS2',
    width: 120,
    tooltipValueGetter: statusTooltipValueGetter('ESTATUS2')
  }
];
