import { createPendientesPage, defaultSortRows } from "./PendientesLocalPage";

const CancelacionesPage = createPendientesPage({
  pageTitle: "Cancelaciones",
  pageSubtitle: "Vista general de registros con cancelaciones.",
  filterBaseRows: defaultSortRows,
  exportFilePrefix: "cancelaciones",
  exportSheetName: "Cancelaciones",
  columnVisibilityStorageKey: "baseDatosColumnVisibility-cancelaciones"
});

export default CancelacionesPage;
