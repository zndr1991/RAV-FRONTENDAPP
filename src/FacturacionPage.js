import { createPendientesPage, defaultSortRows } from "./PendientesLocalPage";

const FacturacionPage = createPendientesPage({
  pageTitle: "Facturacion",
  pageSubtitle: "Vista general de registros de facturacion.",
  filterBaseRows: defaultSortRows,
  exportFilePrefix: "facturacion",
  exportSheetName: "Facturacion",
  columnVisibilityStorageKey: "baseDatosColumnVisibility-facturacion"
});

export default FacturacionPage;
