import { createPendientesPage, defaultSortRows } from "./PendientesLocalPage";

const normalizeLocalidad = (value) => (value ?? "").toString().trim().toLowerCase();

const filterForaneoRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  const filtered = rows.filter(row => normalizeLocalidad(row?.LOCALIDAD) === "foraneo");
  return defaultSortRows(filtered);
};

const PendientesForaneoPage = createPendientesPage({
  pageTitle: "Pendientes For\u00e1neo",
  pageSubtitle: "Registros cuya localidad corresponde al equipo for\u00e1neo.",
  filterBaseRows: filterForaneoRows,
  exportFilePrefix: "pendientes-foraneo",
  exportSheetName: "Pendientes For\u00e1neo",
  columnVisibilityStorageKey: "baseDatosColumnVisibility-foraneo"
});

export default PendientesForaneoPage;
