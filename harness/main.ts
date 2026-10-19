/* Banco de pruebas: ejecuta el visual real con un host simulado de Power BI. */
import { Visual } from "../src/visual";

type AnyObj = any;

/* ---------- Datos de ejemplo: cuenta de resultados ---------- */
interface Line { name: string; style: string; accounts?: { name: string; base: number }[]; calc?: (t: Record<string, number>) => number; }

const LINES: Line[] = [
  { name: "Ingresos", style: "header", accounts: [
    { name: "Ventas de producto", base: 410000 }, { name: "Ventas de servicios", base: 185000 }, { name: "Otros ingresos", base: 12000 } ] },
  { name: "Coste de ventas", style: "", accounts: [
    { name: "Materias primas", base: -168000 }, { name: "Subcontratación", base: -54000 }, { name: "Mano de obra directa", base: -61000 } ] },
  { name: "Margen bruto", style: "subtotal;noexpand", calc: t => t["Ingresos"] + t["Coste de ventas"] },
  { name: "Gastos de personal", style: "", accounts: [
    { name: "Sueldos y salarios", base: -96000 }, { name: "Seguridad Social", base: -30500 } ] },
  { name: "Otros gastos de explotación", style: "", accounts: [
    { name: "Alquileres", base: -18000 }, { name: "Suministros", base: -7400 }, { name: "Marketing", base: -15800 }, { name: "Servicios profesionales", base: -11200 } ] },
  { name: "EBITDA", style: "subtotal;noexpand;line-top", calc: t => t["Margen bruto"] + t["Gastos de personal"] + t["Otros gastos de explotación"] },
  { name: "Amortizaciones", style: "", accounts: [ { name: "Amortización del inmovilizado", base: -14500 } ] },
  { name: "Resultado de explotación", style: "total;noexpand", calc: t => t["EBITDA"] + t["Amortizaciones"] },
];
const YEARS = [2025, 2026];
const QUARTERS = ["T1", "T2", "T3", "T4"];
const SEASON = [0.92, 1.04, 0.88, 1.16];

function amount(acc: string, year: number, q: number): number {
  let h = 0; for (const c of acc) { h = (h * 31 + c.charCodeAt(0)) % 9973; }
  const noise = 0.9 + ((h * (q + 3) * (year - 2020)) % 23) / 100;
  const growth = year === 2026 ? 1.08 : 1;
  const base = LINES.flatMap(l => l.accounts || []).find(a => a.name === acc)!.base;
  return Math.round(base / 4 * SEASON[q] * noise * growth);
}

/* Columnas hoja (orden DFS): año → trimestre → medida, con subtotales */
type ColKey = { year?: number; q?: number }; // undefined = subtotal
const COL_LEAVES: ColKey[] = [];
YEARS.forEach(y => { QUARTERS.forEach((_, q) => COL_LEAVES.push({ year: y, q })); COL_LEAVES.push({ year: y }); });
COL_LEAVES.push({});

function lineTotalsFor(col: ColKey): Record<string, number> {
  const t: Record<string, number> = {};
  for (const l of LINES) {
    if (l.accounts) {
      t[l.name] = l.accounts.reduce((s, a) => s + accountValue(a.name, col), 0);
    } else if (l.calc) { t[l.name] = l.calc(t); }
  }
  return t;
}
function accountValue(acc: string, col: ColKey): number {
  const years = col.year ? [col.year] : YEARS;
  let s = 0;
  years.forEach(y => QUARTERS.forEach((_, q) => { if (col.q === undefined || col.q === q) { s += amount(acc, y, q); } }));
  return s;
}

const valueSources = [
  { displayName: "Real", queryName: "Sum(Importe)", isMeasure: true, format: "#,0 €", roles: { values: true } },
  { displayName: "Presupuesto", queryName: "Sum(Presupuesto)", isMeasure: true, format: "#,0 €", roles: { values: true } },
  { displayName: "Desv. %", queryName: "Desviacion", isMeasure: true, format: "0.0 %;-0.0 %;0.0 %", roles: { values: true } },
  { displayName: "Estilo fila", queryName: "Estilo", isMeasure: true, roles: { rowStyle: true } },
  { displayName: "Formato celda", queryName: "FormatoCelda", isMeasure: true, roles: { cellStyle: true } },
];

/* Presupuesto: el real con una desviación fija por fila (determinista). */
function budgetFactor(key: string): number {
  let h = 7; for (const c of key) { h = (h * 17 + c.charCodeAt(0)) % 1009; }
  return 1 + ((h % 21) - 10) / 100; // ±10 %
}
const cellMeasureOn = { value: true };

function valuesFor(getVal: (col: ColKey) => number, style: string, key: string): AnyObj {
  const v: AnyObj = {};
  let i = 0;
  for (const col of COL_LEAVES) {
    const real = getVal(col);
    const ppto = Math.round(real * budgetFactor(key + (col.q ?? "")));
    const desv = ppto ? (real - ppto) / Math.abs(ppto) : 0;
    v[i++] = { value: real, valueSourceIndex: 0 };
    v[i++] = { value: ppto, valueSourceIndex: 1 };
    v[i++] = { value: desv, valueSourceIndex: 2 };
    v[i++] = { value: style, valueSourceIndex: 3 };
    // Medida "Formato de celda" de ejemplo: resalta en rojo el real cuando la desviación es peor que -5 %.
    v[i++] = { value: cellMeasureOn.value && !/total/.test(style) && desv < -0.05 ? "color=#C4314B;bold" : "", valueSourceIndex: 4 };
  }
  return v;
}

/* ---------- Estado de expansión de filas (lo gestionaría Power BI) ---------- */
const expanded = new Set<string>(["Ingresos", "Coste de ventas"]);
const objPyg: AnyObj = {
  subTotals: { position: "top", showGrandTotal: false },
  general: { fontSize: 10 },
  rowHeaders: { width: window.innerWidth < 600 ? 170 : 240 },
  columnState: { collapsed: JSON.stringify(["root|2025", "root|2026"]) },
  cellStyle: { target: "Sum(Importe)" },
  cfRule1: { show: true, target: "Desviacion", kind: "thresholds", applyTo: "icon", percent: true, lowLimit: -2, highLimit: 2 },
  cfRule2: { show: false, target: "Sum(Importe)", kind: "bars" },
};

function buildPyG(): AnyObj {
  const rowLevels = [
    { sources: [{ displayName: "Epígrafe", queryName: "PyG.Epigrafe" }], canBeExpanded: true },
    { sources: [{ displayName: "Cuenta", queryName: "PyG.Cuenta" }] },
  ];
  const rowsRoot: AnyObj = { children: [] };
  for (const l of LINES) {
    const node: AnyObj = { level: 0, levelValues: [{ value: l.name, levelSourceIndex: 0 }], _key: l.name };
    const getVal = (col: ColKey) => lineTotalsFor(col)[l.name];
    const isOpen = expanded.has(l.name) && !!l.accounts;
    node.isCollapsed = !isOpen;
    if (isOpen) {
      node.children = [
        { isSubtotal: true, level: 1, values: valuesFor(getVal, l.style, l.name) },
        ...l.accounts!.map(a => ({ level: 1, levelValues: [{ value: a.name, levelSourceIndex: 0 }], _key: `${l.name}|${a.name}`,
          values: valuesFor(col => accountValue(a.name, col), "", a.name) })),
      ];
    } else {
      node.values = valuesFor(getVal, l.style, l.name);
    }
    rowsRoot.children.push(node);
  }
  rowsRoot.children.unshift({ isSubtotal: true, level: 0, values: valuesFor(col => lineTotalsFor(col)["Resultado de explotación"], "total", "Resultado de explotación") });

  const measureNodes = () => valueSources.map((_, i) => ({ level: 2, levelSourceIndex: i }));
  const colsRoot: AnyObj = { children: [] };
  for (const y of YEARS) {
    colsRoot.children.push({
      level: 0, levelValues: [{ value: y, levelSourceIndex: 0 }], identity: { key: y },
      children: [
        ...QUARTERS.map(q => ({ level: 1, levelValues: [{ value: q, levelSourceIndex: 0 }], identity: { key: q }, children: measureNodes() })),
        { level: 1, isSubtotal: true, children: measureNodes() },
      ],
    });
  }
  colsRoot.children.push({ level: 0, isSubtotal: true, children: measureNodes() });

  return {
    metadata: { columns: valueSources, objects: JSON.parse(JSON.stringify(objects)) },
    matrix: {
      rows: { root: rowsRoot, levels: rowLevels },
      columns: { root: colsRoot, levels: [
        { sources: [{ displayName: "Año", queryName: "Fecha.Año", format: "0" }] },
        { sources: [{ displayName: "Trimestre", queryName: "Fecha.Trimestre" }] },
        { sources: valueSources },
      ] },
      valueSources,
    },
  };
}

/* ---------- Segundo ejemplo: listado de un solo nivel, sin subtotales ---------- */
const LISTADO: [string, number, number][] = [
  ["Producción", 43431736, 11047423], ["    Materiales", 22231961, -8453905], ["    Mano de obra", 9285089, 56423],
  ["    Gastos de explotación", 4335284, -190429], ["    Subcontratación", 9764196, 10963599], ["    Gasto de contratación", 350676, -175880],
  ["Gastos Directos", 45967206, 2199808], ["Margen Bruto", -2535471, 8847615], ["    Coste Delegación", 1101239, -21741],
  ["    Coste Zona", 53879, 686], ["    Coste Filial", 673706, 0], ["    Coste Corporativo", 2524622, 416348],
  ["Total Coste Indirecto", 4353445, 395293], ["EBIT", -6888916, 8452322], ["Costes financieros", 271624, 43628],
  ["Margen Neto", -7160540, 8408694],
];
const TIPOS = ["A origen", "Mes actual"];
const listadoSources = [
  { displayName: "Contable", queryName: "Contable", isMeasure: true, format: "#,0", roles: { values: true } },
  { displayName: "OC/GC", queryName: "OCGC", isMeasure: true, format: "#,0", roles: { values: true } },
  { displayName: "Total", queryName: "TotalImporte", isMeasure: true, format: "#,0", roles: { values: true } },
  { displayName: "% S/F", queryName: "PctSF", isMeasure: true, format: "0.00 %", roles: { values: true } },
  { displayName: "Indentacion", queryName: "Max(Esquemas.Indentacion)", isMeasure: true, roles: { conditionFields: true } },
];
const PROD_TOTAL = LISTADO[0][1] + LISTADO[0][2];
const objListado: AnyObj = {
  subTotals: { showGrandTotal: false, columnSubtotals: false },
  general: { fontSize: 11 },
  columnHeaders: { background: { solid: { color: "#2B3F6B" } }, fontColor: { solid: { color: "#FFFFFF" } }, bold: false },
  rowFormat1: { show: true, rows: "Producción; Gastos Directos; Margen Bruto; Total Coste Indirecto; EBIT; Margen Neto",
    background: { solid: { color: "#3F7BC8" } }, fontColor: { solid: { color: "#FFFFFF" } } },
  rowFormat2: { show: true, mode: "field", field: "Max(Esquemas.Indentacion)", operator: "eq", value: "1",
    useBackground: false, fontColor: { solid: { color: "#605E5C" } }, italic: true },
};
const listadoMeasureObjects: Record<string, AnyObj> = { OCGC: { valuesFormat: { negativeRed: true } } };

function buildListado(): AnyObj {
  const factor = [1, 0.087];
  const vals = (contable: number, ocgc: number, indent: number) => {
    const v: AnyObj = {}; let i = 0;
    TIPOS.forEach((_, t) => {
      const c = Math.round(contable * factor[t]), o = Math.round(ocgc * factor[t]);
      [c, o || null, c + o, (contable + ocgc) / PROD_TOTAL, indent].forEach((x, m) => { v[i++] = { value: x, valueSourceIndex: m }; });
    });
    return v;
  };
  const rowsRoot: AnyObj = { children: LISTADO.map(([name, c, o]) => ({ level: 0, levelValues: [{ value: name, levelSourceIndex: 0 }], _key: name, values: vals(c, o, name.startsWith(" ") ? 1 : 0) })) };
  const colsRoot: AnyObj = { children: TIPOS.map(t => ({ level: 0, levelValues: [{ value: t, levelSourceIndex: 0 }], identity: { key: t },
    children: listadoSources.map((_, i) => ({ level: 1, levelSourceIndex: i })) })) };
  const sources = listadoSources.map(src => ({ ...src, objects: listadoMeasureObjects[src.queryName] }));
  return {
    metadata: { columns: sources, objects: JSON.parse(JSON.stringify(objListado)) },
    matrix: {
      rows: { root: rowsRoot, levels: [{ sources: [{ displayName: "Epígrafe", queryName: "Listado.Epigrafe" }] }] },
      columns: { root: colsRoot, levels: [{ sources: [{ displayName: "TipoCalculo", queryName: "Listado.TipoCalculo" }] }, { sources }] },
      valueSources: sources,
    },
  };
}

let scenario: "pyg" | "listado" = "listado";
let objects: AnyObj = objListado;
function buildDataView(): AnyObj { return scenario === "pyg" ? buildPyG() : buildListado(); }

/* ---------- Host simulado ---------- */
class SelId {
  constructor(public key: string) {}
  equals(o: SelId) { return !!o && o.key === this.key; }
  getKey() { return this.key; }
  includes(o: SelId) { return this.equals(o); }
  getSelector() { return {}; }
  getSelectorsByColumn() { return {}; }
  hasIdentity() { return true; }
}

let selected: SelId[] = [];
let onSelect: (ids: SelId[]) => void = () => undefined;
let visual: Visual;
const host: AnyObj = {
  locale: "es-ES",
  hostCapabilities: { allowInteractions: true },
  colorPalette: { isHighContrast: false, foreground: { value: "#000" }, background: { value: "#fff" } },
  eventService: { renderingStarted() {}, renderingFinished() {}, renderingFailed(_: AnyObj, e: string) { console.error(e); } },
  fetchMoreData: () => false,
  persistProperties(changes: AnyObj) {
    for (const m of changes.merge || []) { objects[m.objectName] = { ...(objects[m.objectName] || {}), ...m.properties }; }
    refresh();
  },
  createSelectionIdBuilder() {
    let key = "";
    const b: AnyObj = {
      withMatrixNode(node: AnyObj) {
        const part = node._key || (node.isSubtotal ? "#total" : String(node.levelValues?.[0]?.value ?? ""));
        key = key ? `${key}|${part}` : part; return b;
      },
      createSelectionId() { return new SelId(key); },
    };
    return b;
  },
  createSelectionManager() {
    return {
      registerOnSelectCallback(cb: AnyObj) { onSelect = cb; },
      getSelectionIds() { return selected; },
      select(id: SelId, multi: boolean) {
        const has = selected.some(s => s.equals(id));
        if (multi) { selected = has ? selected.filter(s => !s.equals(id)) : [...selected, id]; }
        else { selected = has && selected.length === 1 ? [] : [id]; }
        return Promise.resolve(selected);
      },
      clear() { selected = []; return Promise.resolve(); },
      showContextMenu(id: SelId) { (window as AnyObj).__lastMenu = id?.key; return Promise.resolve(); },
      toggleExpandCollapse(id: SelId) {
        if (expanded.has(id.key)) { expanded.delete(id.key); } else { expanded.add(id.key); }
        refresh(); return Promise.resolve({});
      },
    };
  },
};

function refresh() {
  const el = document.getElementById("visual")!;
  visual.update({ dataViews: [buildDataView()], viewport: { width: el.clientWidth, height: el.clientHeight }, type: 2 } as AnyObj);
}

/* ---------- Controles de la página (simulan el panel de formato) ---------- */
function bindControls() {
  const set = (obj: string, prop: string, v: AnyObj) => { objects[obj] = { ...(objects[obj] || {}), [prop]: v }; refresh(); };
  document.querySelectorAll<HTMLInputElement>("[data-obj]").forEach(inp => {
    inp.addEventListener("change", () => {
      const v = inp.type === "checkbox" ? inp.checked : (inp.type === "number" ? Number(inp.value) : inp.value);
      set(inp.dataset.obj!, inp.dataset.prop!, v);
    });
  });
  document.getElementById("cellMeasure")!.addEventListener("change", e => {
    cellMeasureOn.value = (e.target as HTMLInputElement).checked; refresh();
  });
  document.getElementById("scenario")!.addEventListener("change", e => {
    scenario = (e.target as HTMLSelectElement).value as "pyg" | "listado";
    objects = scenario === "pyg" ? objPyg : objListado;
    document.body.dataset.scenario = scenario;
    (document.querySelector('select[data-prop="widthMode"]') as HTMLSelectElement).value = objects.columnHeaders?.widthMode || "content";
    refresh();
  });
  const applyValueFormat = () => {
    const q = (document.getElementById("negMeasure") as HTMLSelectElement).value;
    const icons = (document.getElementById("valIcons") as HTMLInputElement).checked;
    const fmt = { negativeRed: true, positiveOn: icons, showIcons: icons, iconStyle: "circle" };
    for (const k of Object.keys(listadoMeasureObjects)) { delete listadoMeasureObjects[k]; }
    if (q === "*") { objListado.valuesFormat = fmt; }
    else { objListado.valuesFormat = { negativeRed: false }; if (q) { listadoMeasureObjects[q] = { valuesFormat: fmt }; } }
    refresh();
  };
  document.getElementById("negMeasure")!.addEventListener("change", applyValueFormat);
  document.getElementById("valIcons")!.addEventListener("change", applyValueFormat);
  document.getElementById("hc")!.addEventListener("change", e => {
    host.colorPalette.isHighContrast = (e.target as HTMLInputElement).checked;
    host.colorPalette.foreground.value = "#FFFF00"; host.colorPalette.background.value = "#000000";
    refresh();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("visual")!;
  visual = new Visual({ element: el, host } as AnyObj);
  document.body.dataset.scenario = scenario;
  bindControls();
  refresh();
  void onSelect;
});
