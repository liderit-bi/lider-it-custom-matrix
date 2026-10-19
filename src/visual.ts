/*
 *  LIDER IT Custom Matrix — visual personalizado de Power BI
 *  Copyright (c) LIDER IT (Lider Integrated Technology Consulting, S.L.)
 *  MIT License
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataViewMatrix = powerbi.DataViewMatrix;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { ALL_MEASURES, allMeasuresItem, noFieldItem, RowFormatCard, RuleCard, ValueFormat, ValueFormatSlices, VisualFormattingSettingsModel } from "./settings";
import { addToStats, CellLook, emptyStats, evaluateRule, ICON_GLYPH, parseCellStyle, readableOn, RuleSpec, RuleStats } from "./conditional";
import { buildColumnTree, buildColumnView, ColLeaf, ColView, flattenRows, leavesOf, RowItem } from "./model";
import { parseRowStyle, RowStyle } from "./rowStyle";

const BLANK_LABEL = "(En blanco)";

interface RenderedRow {
    tr: HTMLTableRowElement;
    selectionId?: ISelectionId;
}

/** Celda de valor con su identidad (fila + columna), creada solo cuando se usa. */
interface RenderedCell {
    td: HTMLTableCellElement;
    row: RenderedRow;
    selectionId: ISelectionId;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private container: HTMLDivElement;
    private formattingSettingsService: FormattingSettingsService;
    private settings: VisualFormattingSettingsModel;
    private formatters = new Map<string, valueFormatter.IValueFormatter>();
    private collapsedColumns = new Set<string>();
    private renderedRows: RenderedRow[] = [];
    private renderedCells: RenderedCell[] = [];
    private allowInteractions = true;
    private colorPalette: powerbi.extensibility.ISandboxExtendedColorPalette;
    private lastMatrix: DataViewMatrix | undefined;
    private valueFormats = new Map<string, ValueFormat>();
    private columnWidths: { [key: string]: number } = {};
    private hasExpandableRows = true;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();
        this.allowInteractions = options.host.hostCapabilities?.allowInteractions !== false;
        this.colorPalette = options.host.colorPalette;

        this.container = document.createElement("div");
        this.container.className = "lfm-root";
        options.element.appendChild(this.container);

        this.selectionManager.registerOnSelectCallback(() => this.applySelection());
        this.container.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            if (!this.allowInteractions) { return; }
            this.selectionManager.showContextMenu(this.emptySelectionId(), { x: e.clientX, y: e.clientY });
        });
        this.container.addEventListener("click", (e: MouseEvent) => {
            if (e.target === this.container && this.allowInteractions) {
                this.selectionManager.clear().then(() => this.applySelection());
            }
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView = options.dataViews && options.dataViews[0];
            this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);

            const matrix = dataView?.matrix;
            this.prepareMeasureDropdowns(matrix, dataView?.metadata?.objects);
            if (!matrix || !matrix.valueSources || !matrix.valueSources.length || !matrix.rows?.root) {
                this.renderLanding();
                this.events.renderingFinished(options);
                return;
            }

            if (dataView.metadata?.segment) {
                // Pide el siguiente bloque de filas; Power BI llamará otra vez a update.
                this.host.fetchMoreData(true);
            }

            this.readColumnState(dataView.metadata?.objects);
            this.render(matrix);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.settings);
    }

    /** Rellena los desplegables "Medida" con las medidas del visual y ajusta qué opciones se ven. */
    private prepareMeasureDropdowns(matrix: DataViewMatrix | undefined, objects: powerbi.DataViewObjects | undefined): void {
        const items: powerbi.IEnumMember[] = [allMeasuresItem];
        for (const src of matrix?.valueSources || []) {
            if (src.roles && (src.roles["rowStyle"] || src.roles["cellStyle"] || src.roles["conditionFields"])) { continue; }
            if (src.queryName && !items.some(i => i.value === src.queryName)) {
                items.push({ value: src.queryName, displayName: src.displayName });
            }
        }
        const resolve = (dropdown: { items: powerbi.IEnumMember[]; value: powerbi.IEnumMember }, objectName: string) => {
            dropdown.items = items;
            const saved = objects?.[objectName]?.["target"];
            const found = items.find(i => i.value === saved);
            if (!found && typeof saved === "string" && saved && saved !== ALL_MEASURES) {
                // La medida elegida ya no está en el visual: la regla queda sin efecto en vez de pasar a todas.
                const missing = { value: saved, displayName: "(Medida no disponible)" };
                dropdown.items = [...items, missing];
                dropdown.value = missing;
                return;
            }
            dropdown.value = found || allMeasuresItem;
        };
        for (const rule of this.settings.rules) {
            resolve(rule.target, rule.name);
            rule.refreshVisibility();
        }
        resolve(this.settings.cellStyle.target, this.settings.cellStyle.name);

        // Formato de valores: ajustes generales y, por encima, los de cada medida (guardados con selector de metadatos).
        const vfCard = this.settings.valuesFormat;
        vfCard.general.refreshVisibility();
        const general = vfCard.general.value;
        this.valueFormats.clear();
        const containerItems: { displayName: string; slices: ValueFormatSlices["list"] }[] = [
            { displayName: "(Todas las medidas)", slices: vfCard.general.list }
        ];
        for (const src of matrix?.valueSources || []) {
            if (!src.queryName || (src.roles && (src.roles["rowStyle"] || src.roles["cellStyle"] || src.roles["conditionFields"]))) { continue; }
            const own = src.objects?.["valuesFormat"] || {};
            const merged: ValueFormat = {
                clampOn: pick(own["clampOn"], general.clampOn),
                clampLimit: typeof own["clampLimit"] === "number" ? own["clampLimit"] as number : general.clampLimit,
                showIcons: pick(own["showIcons"], general.showIcons),
                iconStyle: typeof own["iconStyle"] === "string" ? own["iconStyle"] as string : general.iconStyle,
                negativeRed: pick(own["negativeRed"], general.negativeRed),
                negativeColor: pickColor(own["negativeColor"], general.negativeColor),
                positiveOn: pick(own["positiveOn"], general.positiveOn),
                positiveColor: pickColor(own["positiveColor"], general.positiveColor),
                negativeParentheses: pick(own["negativeParentheses"], general.negativeParentheses),
                blankAsDash: pick(own["blankAsDash"], general.blankAsDash)
            };
            this.valueFormats.set(src.queryName, merged);
            const slices = new ValueFormatSlices(merged, { metadata: src.queryName });
            containerItems.push({ displayName: src.displayName, slices: slices.list });
        }
        vfCard.container.containerItems = containerItems;

        // Desplegable "Campo" de las tarjetas de formato de filas: los campos de "Campos de condición".
        const fieldItems: powerbi.IEnumMember[] = (matrix?.valueSources || [])
            .filter(src => !!src.roles?.["conditionFields"] && !!src.queryName)
            .map(src => ({ value: src.queryName as string, displayName: src.displayName }));
        this.settings.rowFormats.forEach(card => {
            const saved = objects?.[card.name]?.["field"];
            const items = fieldItems.length ? fieldItems : [noFieldItem];
            const found = items.find(i => i.value === saved);
            if (!found && typeof saved === "string" && saved) {
                const missing = { value: saved, displayName: "(Campo no disponible)" };
                card.field.items = [...items, missing];
                card.field.value = missing;
            } else {
                card.field.items = items;
                card.field.value = found || items[0];
            }
            card.refreshVisibility();
        });
        this.settings.columnHeaders.refreshVisibility();
        this.settings.rowHeaders.width.visible = !this.settings.rowHeaders.autoWidth.value;
        this.settings.rowHeaders.title.visible = this.settings.rowHeaders.showTitle.value;
    }

    /* ---------------- Render ---------------- */

    private renderLanding(): void {
        this.container.replaceChildren();
        this.renderedRows = [];
        this.renderedCells = [];
        const msg = document.createElement("div");
        msg.className = "lfm-landing";
        const title = document.createElement("p");
        title.className = "lfm-landing-title";
        title.textContent = "LIDER IT Custom Matrix";
        const hint = document.createElement("p");
        hint.textContent = "Añade campos a Filas y Valores para crear la matriz.";
        msg.append(title, hint);
        this.container.appendChild(msg);
    }

    private render(matrix: DataViewMatrix): void {
        const s = this.settings;
        const g = s.general;
        if (this.colorPalette?.isHighContrast) {
            this.applyHighContrast();
        }
        this.container.replaceChildren();
        this.renderedRows = [];
        this.renderedCells = [];

        this.lastMatrix = matrix;
        this.container.style.fontFamily = g.fontFamily.value;
        this.container.style.fontSize = `${g.fontSize.value}pt`;
        this.container.style.color = g.fontColor.value.value;
        this.container.style.backgroundColor = g.background.value.value;

        const styleIndex = matrix.valueSources.findIndex(v => !!v.roles && !!v.roles["rowStyle"]);
        const labelFmt = (value: PrimitiveValue, source: DataViewMetadataColumn | undefined) => this.formatLabel(value, source);

        const cellStyleIndex = matrix.valueSources.findIndex(v => !!v.roles && !!v.roles["cellStyle"]);
        const colTree = buildColumnTree(matrix, styleIndex, cellStyleIndex, labelFmt);
        const showColSubtotals = s.subTotals.columnSubtotals.value;
        const colViews = buildColumnView(colTree, this.collapsedColumns, showColSubtotals);
        const leaves = leavesOf(colViews);

        const position = (s.subTotals.position.value?.value as "top" | "bottom") || "top";
        const rows = flattenRows(matrix, position, s.subTotals.showGrandTotal.value, labelFmt);

        const table = document.createElement("table");
        table.className = "lfm-table";
        table.style.setProperty("--lfm-grid", g.gridColor.value.value);
        table.style.setProperty("--lfm-bg", g.background.value.value);

        const colgroup = document.createElement("colgroup");
        const cols = [ROW_HEADER_KEY, ...leaves.map(l => l.key || "")].map(key => {
            const col = document.createElement("col");
            col.dataset.key = key;
            colgroup.appendChild(col);
            return col;
        });
        table.appendChild(colgroup);

        this.hasExpandableRows = rows.some(r => r.expandable) || (matrix.rows.levels || []).length > 1;
        table.appendChild(this.renderHeader(matrix, colViews));
        table.appendChild(this.renderBody(matrix, rows, leaves, styleIndex));
        this.container.appendChild(table);
        this.layoutColumns(table, cols);
        this.applySelection();
    }

    /* ---------------- Ancho de columnas ---------------- */

    /**
     * Mide el ancho natural de cada columna (tabla en modo automático) y fija el definitivo:
     * ancho arrastrado a mano > modo del panel (contenido, ancho del visual o fijo).
     */
    private layoutColumns(table: HTMLTableElement, cols: HTMLTableColElement[]): void {
        const s = this.settings;
        const firstRow = table.tBodies[0]?.rows[0] || table.tHead?.rows[table.tHead.rows.length - 1];
        const natural = cols.map((_, i) => {
            const cell = firstRow && firstRow.cells.length === cols.length ? firstRow.cells[i] : undefined;
            return cell ? Math.ceil(cell.getBoundingClientRect().width) : 90;
        });

        const mode = String(s.columnHeaders.widthMode.value?.value || "content");
        const widths = natural.map((w, i) => {
            if (i === 0) {
                return s.rowHeaders.autoWidth.value ? Math.max(60, w) : Math.max(60, s.rowHeaders.width.value);
            }
            return mode === "fixed" ? Math.max(30, s.columnHeaders.fixedWidth.value) : Math.max(40, w);
        });

        if (mode === "fill") {
            // Reparte el espacio sobrante entre las columnas de valores (nunca las estrecha).
            const available = this.container.clientWidth;
            const manualTotal = cols.reduce((a, c, i) => a + (this.manualWidth(c) ?? (i === 0 ? widths[0] : 0)), 0);
            const flexible = widths.slice(1).reduce((a, w, i) => a + (this.manualWidth(cols[i + 1]) === undefined ? w : 0), 0);
            const extra = available - manualTotal - flexible;
            if (extra > 0 && flexible > 0) {
                for (let i = 1; i < widths.length; i++) {
                    if (this.manualWidth(cols[i]) === undefined) { widths[i] = Math.floor(widths[i] * (1 + extra / flexible)); }
                }
            }
        }

        let total = 0;
        cols.forEach((col, i) => {
            const w = this.manualWidth(col) ?? widths[i];
            col.style.width = `${w}px`;
            total += w;
        });
        table.style.tableLayout = "fixed";
        table.style.width = `${total}px`;
        table.classList.add("lfm-laid-out");
    }

    private manualWidth(col: HTMLTableColElement): number | undefined {
        const w = this.columnWidths[col.dataset.key || ""];
        return typeof w === "number" && w > 0 ? w : undefined;
    }

    /** Asa para arrastrar el borde derecho de un encabezado; doble clic vuelve al ajuste automático. */
    private resizeHandle(key: string): HTMLSpanElement {
        const handle = document.createElement("span");
        handle.className = "lfm-resize";
        handle.setAttribute("aria-hidden", "true");
        handle.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
        handle.addEventListener("dblclick", (e: MouseEvent) => {
            e.stopPropagation();
            delete this.columnWidths[key];
            this.persistColumnWidths();
        });
        handle.addEventListener("pointerdown", (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const table = handle.closest("table") as HTMLTableElement | null;
            const col = table?.querySelector<HTMLTableColElement>(`col[data-key="${cssEscape(key)}"]`);
            if (!table || !col) { return; }
            const startX = e.clientX;
            const startW = col.getBoundingClientRect().width || parseFloat(col.style.width) || 90;
            const startTable = parseFloat(table.style.width) || table.getBoundingClientRect().width;
            handle.setPointerCapture?.(e.pointerId);
            const move = (ev: PointerEvent) => {
                const w = Math.max(30, Math.round(startW + ev.clientX - startX));
                col.style.width = `${w}px`;
                table.style.width = `${startTable + w - startW}px`;
            };
            const up = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", up);
                handle.removeEventListener("pointercancel", up);
                this.columnWidths[key] = Math.round(parseFloat(col.style.width));
                this.persistColumnWidths();
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", up);
            handle.addEventListener("pointercancel", up);
        });
        return handle;
    }

    private persistColumnWidths(): void {
        this.host.persistProperties({
            merge: [{ objectName: "columnState", selector: null, properties: { widths: JSON.stringify(this.columnWidths) } }]
        });
    }

    private renderHeader(matrix: DataViewMatrix, colViews: ColView[]): HTMLTableSectionElement {
        const ch = this.settings.columnHeaders;
        const thead = document.createElement("thead");
        thead.style.backgroundColor = ch.background.value.value;
        thead.style.color = ch.fontColor.value.value;
        thead.style.fontWeight = ch.bold.value ? "600" : "400";

        const depthOf = (v: ColView): number => v.children.length ? 1 + Math.max(...v.children.map(depthOf)) : 1;
        const leafCount = (v: ColView): number => v.children.length ? v.children.reduce((a, c) => a + leafCount(c), 0) : 1;
        const depth = Math.max(1, ...colViews.map(depthOf));

        const trs: HTMLTableRowElement[] = [];
        for (let i = 0; i < depth; i++) {
            trs.push(document.createElement("tr"));
        }

        const corner = document.createElement("th");
        corner.className = "lfm-corner";
        corner.rowSpan = depth;
        corner.style.backgroundColor = ch.background.value.value;
        // Título de la columna de filas: oculto, personalizado o, por defecto, los nombres de los campos.
        const rh = this.settings.rowHeaders;
        const custom = String(rh.title.value || "").trim();
        corner.textContent = !rh.showTitle.value ? "" : (custom || (matrix.rows.levels || [])
            .map(l => l.sources.map(src => src.displayName).join(" "))
            .join(" / "));
        corner.appendChild(this.resizeHandle(ROW_HEADER_KEY));
        trs[0].appendChild(corner);

        const place = (v: ColView, d: number) => {
            const th = document.createElement("th");
            th.className = "lfm-colheader";
            if (v.isSubtotal) { th.classList.add("lfm-colsubtotal"); }
            if (v.children.length) { th.classList.add("lfm-colgroup"); }
            th.colSpan = leafCount(v);
            if (!v.children.length && d < depth - 1) {
                th.rowSpan = depth - d;
            }
            if (v.toggle) {
                th.appendChild(this.toggleButton(v.toggle === "expand", () => this.toggleColumn(v.key), v.label));
            }
            const span = document.createElement("span");
            span.textContent = v.label;
            th.appendChild(span);
            if (!v.children.length) {
                th.appendChild(this.resizeHandle(v.key));
            }
            trs[d].appendChild(th);
            v.children.forEach(c => place(c, d + 1));
        };
        colViews.forEach(v => place(v, 0));

        trs.forEach(tr => thead.appendChild(tr));
        return thead;
    }

    private renderBody(matrix: DataViewMatrix, rows: RowItem[], leaves: ColLeaf[], styleIndex: number): HTMLTableSectionElement {
        const s = this.settings;
        const tbody = document.createElement("tbody");
        let band = 0;

        const styles = rows.map(row => styleIndex >= 0 ? parseRowStyle(this.styleValue(row, styleIndex)) : {} as RowStyle);
        const rules = this.activeRules(matrix);
        const stats = this.ruleStats(rules, rows, styles, leaves);
        const cellTarget = s.cellStyle.target.value?.value;
        const highContrast = !!this.colorPalette?.isHighContrast;

        rows.forEach((row, rowIndex) => {
            const style = styles[rowIndex];
            if (style.hide) { return; }

            const tr = document.createElement("tr");
            tr.className = `lfm-row lfm-${row.kind}`;
            const look = this.rowLook(row, style, band % 2 === 1);
            band++;

            const th = document.createElement("th");
            th.className = "lfm-rowheader";
            th.scope = "row";
            const indent = s.rowHeaders.indent.value * (row.level + (style.indent || 0) + (look.indent || 0));
            th.style.paddingLeft = `${6 + indent}px`;
            if (row.expandable && !style.noExpand) {
                th.appendChild(this.toggleButton(row.isCollapsed, () => this.toggleRow(row, matrix), row.label));
            } else if (this.hasExpandableRows) {
                const spacer = document.createElement("span");
                spacer.className = "lfm-spacer";
                th.appendChild(spacer);
            }
            const label = document.createElement("span");
            label.className = "lfm-label";
            label.textContent = row.label;
            label.title = row.label;
            th.appendChild(label);
            this.applyLook(th, look, true);
            tr.appendChild(th);

            const rowIsTotal = this.isTotalRow(row, style);
            const rendered: RenderedRow = { tr, selectionId: row.kind === "grand" ? undefined : this.rowSelectionId(row, matrix) };
            for (const leaf of leaves) {
                const td = document.createElement("td");
                this.bindCellEvents(td, rendered, () => this.cellSelectionId(row, leaf, matrix));
                td.className = "lfm-value";
                this.applyLook(td, look, false);
                if (!style.blankValues) {
                    const cell = row.values ? row.values[leaf.valueIndex] : undefined;
                    const measureIndex = cell?.valueSourceIndex ?? leaf.measureIndex;
                    const source = matrix.valueSources[measureIndex];
                    const sign = style.signFactor || 1;
                    this.fillValue(td, cell?.value, source, sign, !!look.color);

                    // Formato condicional: reglas del panel y, por encima, la medida "Formato de celda".
                    const cellLook: CellLook = {};
                    const raw = cell?.value;
                    if (typeof raw === "number") {
                        const v = this.displayNumber(raw, source, sign);
                        rules.forEach((rule, ri) => {
                            if (!this.ruleApplies(rule, source, rowIsTotal || !!leaf.isTotal)) { return; }
                            Object.assign(cellLook, evaluateRule(rule.spec, v, stats[ri].get(measureIndex) || emptyStats()));
                        });
                    }
                    if (leaf.cellStyleIndex !== undefined && row.values
                        && (cellTarget === ALL_MEASURES || cellTarget === source?.queryName)) {
                        Object.assign(cellLook, parseCellStyle(row.values[leaf.cellStyleIndex]?.value));
                    }
                    this.applyCellLook(td, cellLook, highContrast);
                }
                tr.appendChild(td);
            }

            this.bindRowEvents(tr, rendered.selectionId);
            this.renderedRows.push(rendered);
            tbody.appendChild(tr);
        });
        return tbody;
    }

    /* ---------------- Formato condicional ---------------- */

    private activeRules(matrix: DataViewMatrix): ActiveRule[] {
        if (!matrix.valueSources.length) { return []; }
        return this.settings.rules
            .filter(card => card.show.value)
            .map(card => ({ target: String(card.target.value?.value ?? ALL_MEASURES), spec: this.ruleSpec(card) }));
    }

    private ruleSpec(card: RuleCard): RuleSpec {
        const k = card.percent.value ? 0.01 : 1;
        const applyTo = (card.applyTo.value?.value as RuleSpec["applyTo"]) || "background";
        // Los colores por defecto son tonos suaves pensados para fondo; para texto o iconos se usan sus equivalentes intensos.
        const tone = (c: string) => applyTo === "background" ? c : (STRONG_TONE[c.toUpperCase()] || c);
        const low = Number(card.lowLimit.value) * k;
        const high = Number(card.highLimit.value) * k;
        return {
            kind: (card.kind.value?.value as RuleSpec["kind"]) || "thresholds",
            applyTo,
            includeTotals: card.includeTotals.value,
            minColor: card.minColor.value.value, useMid: card.useMid.value, midValue: Number(card.midValue.value) || 0,
            midColor: card.midColor.value.value, maxColor: card.maxColor.value.value,
            low: Math.min(low, high), high: Math.max(low, high),
            lowColor: tone(card.lowColor.value.value), colorMiddle: card.colorMiddle.value,
            middleColor: tone(card.middleColor.value.value), highColor: tone(card.highColor.value.value),
            barPositive: card.barPositive.value.value, barNegative: card.barNegative.value.value
        };
    }

    private ruleApplies(rule: ActiveRule, source: DataViewMetadataColumn | undefined, isTotal: boolean): boolean {
        if (isTotal && !rule.spec.includeTotals) { return false; }
        return rule.target === ALL_MEASURES || rule.target === source?.queryName;
    }

    private isTotalRow(row: RowItem, style: RowStyle): boolean {
        return row.kind !== "data" || style.preset === "subtotal" || style.preset === "total";
    }

    /** Mínimo y máximo de cada medida para las escalas y barras (solo las celdas a las que aplica la regla). */
    private ruleStats(rules: ActiveRule[], rows: RowItem[], styles: RowStyle[], leaves: ColLeaf[]): Map<number, RuleStats>[] {
        return rules.map(rule => {
            const byMeasure = new Map<number, RuleStats>();
            if (rule.spec.kind === "thresholds") { return byMeasure; }
            rows.forEach((row, i) => {
                const style = styles[i];
                if (style.hide || style.blankValues || !row.values) { return; }
                const rowIsTotal = this.isTotalRow(row, style);
                for (const leaf of leaves) {
                    const cell = row.values[leaf.valueIndex];
                    if (!cell || typeof cell.value !== "number") { continue; }
                    const measureIndex = cell.valueSourceIndex ?? leaf.measureIndex;
                    const source = (this.lastMatrix?.valueSources || [])[measureIndex];
                    if (!this.ruleApplies(rule, source, rowIsTotal || !!leaf.isTotal)) { continue; }
                    let st = byMeasure.get(measureIndex);
                    if (!st) { st = emptyStats(); byMeasure.set(measureIndex, st); }
                    addToStats(st, this.displayNumber(cell.value, source, style.signFactor || 1));
                }
            });
            return byMeasure;
        });
    }

    private applyCellLook(td: HTMLTableCellElement, look: CellLook, highContrast: boolean): void {
        if (!highContrast) {
            if (look.background) {
                td.style.backgroundColor = look.background;
                if (!look.color && readableOn(look.background) === "#FFFFFF") { td.style.color = "#FFFFFF"; }
            }
            if (look.color) { td.style.color = look.color; }
        }
        if (look.bold) { td.style.fontWeight = "600"; }
        if (look.italic) { td.style.fontStyle = "italic"; }
        if (look.icon) {
            const icon = document.createElement("span");
            icon.className = "lfm-icon";
            icon.textContent = ICON_GLYPH[look.icon];
            icon.setAttribute("aria-hidden", "true");
            if (look.iconColor && !highContrast) { icon.style.color = look.iconColor; }
            td.insertBefore(icon, td.firstChild);
        }
        if (look.bar && !highContrast) {
            const text = document.createElement("span");
            text.className = "lfm-bar-text";
            while (td.firstChild) { text.appendChild(td.firstChild); }
            const bar = document.createElement("span");
            bar.className = "lfm-bar";
            bar.style.left = `${look.bar.left}%`;
            bar.style.width = `${look.bar.width}%`;
            bar.style.backgroundColor = look.bar.color;
            td.classList.add("lfm-has-bar");
            td.append(bar, text);
        }
    }

    /* ---------------- Estilos ---------------- */

    /** En alto contraste se usan solo los colores del sistema. */
    private applyHighContrast(): void {
        const fg = this.colorPalette.foreground.value;
        const bg = this.colorPalette.background.value;
        const s = this.settings;
        const set = (c: { value: { value: string } }, v: string) => { c.value = { value: v }; };
        set(s.general.fontColor, fg); set(s.general.background, bg); set(s.general.gridColor, fg);
        s.general.bandedRows.value = false;
        set(s.columnHeaders.background, bg); set(s.columnHeaders.fontColor, fg);
        set(s.subTotals.grandTotalBackground, bg); set(s.subTotals.grandTotalFontColor, fg);
        const rs = s.rowStyles;
        [rs.headerBackground, rs.subtotalBackground, rs.totalBackground].forEach(c => set(c, bg));
        [rs.headerFontColor, rs.subtotalFontColor, rs.totalFontColor, rs.lineColor].forEach(c => set(c, fg));
    }

    private rowLook(row: RowItem, style: RowStyle, banded: boolean): RowLook {
        const s = this.settings;
        const rs = s.rowStyles;
        const look: RowLook = {};
        const isGroup = row.expandable || row.kind === "subtotal";

        if (s.general.bandedRows.value && banded) { look.background = s.general.bandColor.value.value; }
        if (isGroup && s.rowHeaders.boldGroups.value) { look.bold = true; }

        if (row.kind === "subtotal") {
            look.background = rs.subtotalBackground.value.value;
            look.color = rs.subtotalFontColor.value.value;
            look.bold = true;
            look.lineTop = true;
        }
        if (row.kind === "grand") {
            look.background = s.subTotals.grandTotalBackground.value.value;
            look.color = s.subTotals.grandTotalFontColor.value.value;
            look.bold = true;
            look.lineTop = true;
        }

        switch (style.preset) {
            case "header":
                look.background = rs.headerBackground.value.value;
                look.color = rs.headerFontColor.value.value;
                look.bold = true;
                break;
            case "subtotal":
                look.background = rs.subtotalBackground.value.value;
                look.color = rs.subtotalFontColor.value.value;
                look.bold = true;
                look.lineTop = true;
                break;
            case "total":
                look.background = rs.totalBackground.value.value;
                look.color = rs.totalFontColor.value.value;
                look.bold = true;
                look.lineTop = true;
                look.doubleBottom = true;
                break;
        }

        if (style.bold) { look.bold = true; }
        if (style.italic) { look.italic = true; }
        if (style.underline) { look.underline = true; }
        if (style.background && !this.colorPalette?.isHighContrast) { look.background = style.background; }
        if (style.color && !this.colorPalette?.isHighContrast) { look.color = style.color; }
        if (style.lineTop) { look.lineTop = true; }
        if (style.lineBottom) { look.lineBottom = true; }
        if (style.doubleBottom) { look.doubleBottom = true; }
        look.lineColor = rs.lineColor.value.value;

        // Formato de filas del panel: por nombre de fila, por encima de la medida de estilo.
        for (const card of this.settings.rowFormats) {
            if (!card.show.value || !this.rowFormatApplies(card, row)) { continue; }
            if (card.useBackground.value && !this.colorPalette?.isHighContrast) { look.background = card.background.value.value; }
            if (card.useFontColor.value && !this.colorPalette?.isHighContrast) { look.color = card.fontColor.value.value; }
            if (card.bold.value) { look.bold = true; }
            if (card.italic.value) { look.italic = true; }
            if (card.lineTop.value) { look.lineTop = true; }
            if (card.indent.value > 0) { look.indent = Math.min(10, Math.round(card.indent.value)); }
        }
        return look;
    }

    private applyLook(cell: HTMLElement, look: RowLook, isHeader: boolean): void {
        cell.style.backgroundColor = look.background || this.settings.general.background.value.value;
        if (look.color) { cell.style.color = look.color; }
        cell.style.fontWeight = look.bold ? "600" : (isHeader ? "400" : "");
        if (look.italic) { cell.style.fontStyle = "italic"; }
        if (look.underline) { cell.style.textDecoration = "underline"; }
        if (look.lineTop) { cell.style.borderTop = `1px solid ${look.lineColor}`; }
        if (look.lineBottom) { cell.style.borderBottom = `1px solid ${look.lineColor}`; }
        if (look.doubleBottom) { cell.style.borderBottom = `3px double ${look.lineColor}`; }
    }

    /** La tarjeta de formato de filas aplica a esta fila: por su texto o por el valor de un campo de condición. */
    private rowFormatApplies(card: RowFormatCard, row: RowItem): boolean {
        if (card.mode.value?.value !== "field") {
            return matchesRow(card, row.label);
        }
        const queryName = String(card.field.value?.value || "");
        const sources = this.lastMatrix?.valueSources || [];
        const index = sources.findIndex(src => src.queryName === queryName && !!src.roles?.["conditionFields"]);
        if (index < 0) { return false; }
        return compareCondition(this.styleValue(row, index), String(card.operator.value?.value || "eq"), String(card.value.value ?? ""));
    }

    /* ---------------- Valores ---------------- */

    /** Formato de valores de una medida: el suyo propio o, si no tiene, el general. */
    private valueFormatFor(source: DataViewMetadataColumn | undefined): ValueFormat {
        return (source?.queryName && this.valueFormats.get(source.queryName)) || this.settings.valuesFormat.general.value;
    }

    /** Valor numérico tal como se muestra: con el signo de la fila y, si se pide, limitado a ±límite %. */
    private displayNumber(raw: number, source: DataViewMetadataColumn | undefined, sign: number): number {
        const vf = this.valueFormatFor(source);
        const v = raw * sign;
        if (!vf.clampOn) { return v; }
        const limit = Math.abs(vf.clampLimit || 100) / 100;
        return Math.max(-limit, Math.min(limit, v));
    }

    /** Icono fijo a la derecha del valor según su signo (cero sin icono). */
    private valueIcon(value: number, vf: ValueFormat): HTMLSpanElement | undefined {
        if (!vf.showIcons || value === 0 || !Number.isFinite(value)) { return undefined; }
        const positive = value > 0;
        const color = this.colorPalette?.isHighContrast ? this.colorPalette.foreground.value : (positive ? vf.positiveColor : vf.negativeColor);
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        if (vf.iconStyle === "circle") {
            icon.className = "lfm-vicon lfm-vicon-circle";
            icon.textContent = positive ? "✓" : "✕";
            icon.style.backgroundColor = color;
        } else {
            icon.className = "lfm-vicon";
            icon.textContent = vf.iconStyle === "arrow" ? (positive ? "▲" : "▼") : "●";
            icon.style.color = color;
        }
        return icon;
    }

    private fillValue(td: HTMLTableCellElement, raw: PrimitiveValue | undefined, source: DataViewMetadataColumn | undefined,
        sign: number, rowHasColor: boolean): void {
        const vf = this.valueFormatFor(source);
        const highContrast = !!this.colorPalette?.isHighContrast;
        if (raw === null || raw === undefined || raw === "") {
            td.textContent = vf.blankAsDash ? "–" : "";
            return;
        }
        if (typeof raw === "number") {
            const value = this.displayNumber(raw, source, sign);
            const formatter = this.formatter(source?.format);
            // En filas con color de texto propio (cabeceras, totales…) se respeta ese color.
            const tint = !rowHasColor && !highContrast;
            if (value < 0) {
                if (vf.negativeRed && tint) { td.style.color = vf.negativeColor; }
                td.textContent = vf.negativeParentheses ? `(${formatter.format(Math.abs(value))})` : formatter.format(value);
            } else {
                if (vf.positiveOn && tint && value > 0) { td.style.color = vf.positiveColor; }
                td.textContent = formatter.format(value);
            }
            const icon = this.valueIcon(value, vf);
            if (icon) { td.appendChild(icon); }
            return;
        }
        td.textContent = this.formatter(source?.format).format(raw);
    }

    private styleValue(row: RowItem, styleIndex: number): PrimitiveValue | undefined {
        const values = row.styleValues;
        if (!values) { return undefined; }
        for (const key of Object.keys(values)) {
            const cell = values[Number(key)];
            if ((cell.valueSourceIndex || 0) === styleIndex) {
                return cell.value;
            }
        }
        return undefined;
    }

    private formatLabel(value: PrimitiveValue, source: DataViewMetadataColumn | undefined): string {
        if (value === null || value === undefined || value === "") { return BLANK_LABEL; }
        return this.formatter(source?.format).format(value);
    }

    private formatter(format: string | undefined): valueFormatter.IValueFormatter {
        const key = format || "";
        let f = this.formatters.get(key);
        if (!f) {
            f = valueFormatter.create({ format: format, cultureSelector: this.host.locale });
            this.formatters.set(key, f);
        }
        return f;
    }

    /* ---------------- Interacción ---------------- */

    private toggleButton(collapsed: boolean, onToggle: () => void, label: string): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.className = "lfm-toggle";
        btn.type = "button";
        btn.textContent = collapsed ? "+" : "−";
        btn.setAttribute("aria-expanded", String(!collapsed));
        btn.setAttribute("aria-label", `${collapsed ? "Expandir" : "Contraer"} ${label}`);
        btn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            onToggle();
        });
        return btn;
    }

    private toggleRow(row: RowItem, matrix: DataViewMatrix): void {
        const id = this.rowSelectionId(row, matrix);
        if (id) {
            this.selectionManager.toggleExpandCollapse(id);
        }
    }

    private toggleColumn(key: string): void {
        if (this.collapsedColumns.has(key)) {
            this.collapsedColumns.delete(key);
        } else {
            this.collapsedColumns.add(key);
        }
        // Se guarda en el informe para que el estado sobreviva a recargas, marcadores e impresión.
        this.host.persistProperties({
            merge: [{
                objectName: "columnState",
                selector: null,
                properties: { collapsed: JSON.stringify(Array.from(this.collapsedColumns)) }
            }]
        });
    }

    private readColumnState(objects: powerbi.DataViewObjects | undefined): void {
        const rawWidths = objects?.["columnState"]?.["widths"];
        this.columnWidths = {};
        if (typeof rawWidths === "string") {
            try {
                const parsed: unknown = JSON.parse(rawWidths);
                if (parsed && typeof parsed === "object") {
                    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                        if (typeof v === "number" && v > 0) { this.columnWidths[k] = v; }
                    }
                }
            } catch {
                // Anchos corruptos: se vuelve al ajuste automático.
            }
        }
        const raw = objects?.["columnState"]?.["collapsed"];
        if (typeof raw !== "string") { return; }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                this.collapsedColumns = new Set(parsed.filter((k): k is string => typeof k === "string"));
            }
        } catch {
            // Estado corrupto: se ignora y se muestran todas las columnas expandidas.
        }
    }

    private rowSelectionId(row: RowItem, matrix: DataViewMatrix): ISelectionId | undefined {
        try {
            return this.host.createSelectionIdBuilder()
                .withMatrixNode(row.node, matrix.rows.levels)
                .createSelectionId();
        } catch {
            return undefined;
        }
    }

    /**
     * Identidad de una celda: la fila y los grupos de columna (p. ej. Epígrafe + CompanyName).
     * Es lo que Power BI usa para filtrar en cruzado y para pasar los filtros a "Obtener detalles".
     */
    private cellSelectionId(row: RowItem, leaf: ColLeaf, matrix: DataViewMatrix): ISelectionId | undefined {
        try {
            let builder = this.host.createSelectionIdBuilder();
            if (row.kind !== "grand") {
                builder = builder.withMatrixNode(row.node, matrix.rows.levels);
            }
            const columnPath = this.settings.general.cellFilterColumns.value ? (leaf.columnPath || []) : [];
            if (row.kind === "grand" && !columnPath.length) { return undefined; }
            for (const node of columnPath) {
                builder = builder.withMatrixNode(node, matrix.columns.levels);
            }
            return builder.createSelectionId();
        } catch {
            return undefined;
        }
    }

    private bindCellEvents(td: HTMLTableCellElement, row: RenderedRow, makeId: () => ISelectionId | undefined): void {
        let cell: RenderedCell | undefined;
        const resolve = (): RenderedCell | undefined => {
            if (!cell) {
                const id = makeId();
                if (!id) { return undefined; }
                cell = { td, row, selectionId: id };
                this.renderedCells.push(cell);
            }
            return cell;
        };
        td.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (!this.allowInteractions) { return; }
            const c = resolve();
            if (!c) { return; }
            this.selectionManager.select(c.selectionId, e.ctrlKey || e.metaKey).then(() => this.applySelection());
        });
        td.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.allowInteractions) { return; }
            const c = resolve();
            this.selectionManager.showContextMenu(c?.selectionId || row.selectionId || this.emptySelectionId(), { x: e.clientX, y: e.clientY });
        });
    }

    private emptySelectionId(): ISelectionId {
        return this.host.createSelectionIdBuilder().createSelectionId();
    }

    private bindRowEvents(tr: HTMLTableRowElement, selectionId: ISelectionId | undefined): void {
        tr.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (!selectionId || !this.allowInteractions) { return; }
            this.selectionManager.select(selectionId, e.ctrlKey || e.metaKey).then(() => this.applySelection());
        });
        tr.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.allowInteractions) { return; }
            this.selectionManager.showContextMenu(selectionId || this.emptySelectionId(), { x: e.clientX, y: e.clientY });
        });
    }

    private applySelection(): void {
        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const any = selected.length > 0;
        const isSelected = (id: ISelectionId | undefined) => !!id && selected.some(sel => sel.equals(id));
        const rowsWithCell = new Set<RenderedRow>();
        for (const c of this.renderedCells) {
            const on = isSelected(c.selectionId);
            c.td.classList.toggle("lfm-cell-selected", on);
            if (on) { rowsWithCell.add(c.row); }
        }
        for (const r of this.renderedRows) {
            const isSel = isSelected(r.selectionId);
            r.tr.classList.toggle("lfm-selected", isSel);
            r.tr.classList.toggle("lfm-dimmed", any && !isSel && !rowsWithCell.has(r));
        }
    }
}

const ROW_HEADER_KEY = "__rows";

function pick(v: powerbi.DataViewPropertyValue | undefined, fallback: boolean): boolean {
    return typeof v === "boolean" ? v : fallback;
}

function pickColor(v: powerbi.DataViewPropertyValue | undefined, fallback: string): string {
    const c = (v as powerbi.Fill | undefined)?.solid?.color;
    return typeof c === "string" && c ? c : fallback;
}

function cssEscape(v: string): string {
    return v.replace(/["\\]/g, "\\$&");
}

/** Normaliza para comparar nombres de fila: sin mayúsculas, acentos ni espacios repetidos. */
function normalize(v: string): string {
    return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Compara el valor de un campo con el de la tarjeta: como número si ambos lo son, si no como texto (sin mayúsculas ni acentos). */
function compareCondition(raw: PrimitiveValue | undefined, op: string, expected: string): boolean {
    if (raw === null || raw === undefined) { return false; }
    const toNumber = (v: unknown): number | undefined => {
        if (typeof v === "number") { return v; }
        const t = String(v).trim().replace(",", ".");
        return t !== "" && Number.isFinite(Number(t)) ? Number(t) : undefined;
    };
    const a = toNumber(raw), b = toNumber(expected);
    if (op === "contains") {
        return normalize(String(raw)).includes(normalize(expected));
    }
    let cmp: number;
    if (a !== undefined && b !== undefined) {
        cmp = a === b ? 0 : (a < b ? -1 : 1);
    } else {
        const x = normalize(String(raw)), y = normalize(expected);
        cmp = x === y ? 0 : (x < y ? -1 : 1);
    }
    switch (op) {
        case "ne": return cmp !== 0;
        case "gt": return cmp > 0;
        case "ge": return cmp >= 0;
        case "lt": return cmp < 0;
        case "le": return cmp <= 0;
        default: return cmp === 0;
    }
}

/** Coincidencia por nombre; "*" al principio o al final hace de comodín (Total*, *Margen*). */
function matchesRow(card: RowFormatCard, label: string): boolean {
    const name = normalize(label);
    return String(card.rows.value || "").split(";").map(normalize).filter(Boolean).some(p => {
        const starts = p.endsWith("*"), ends = p.startsWith("*");
        const core = p.replace(/^\*+|\*+$/g, "");
        if (!core) { return false; }
        if (starts && ends) { return name.includes(core); }
        if (starts) { return name.startsWith(core); }
        if (ends) { return name.endsWith(core); }
        return name === core;
    });
}

const STRONG_TONE: Record<string, string> = { "#F8D7DA": "#C4314B", "#FFF4CE": "#B07800", "#DFF6DD": "#107C10" };

interface ActiveRule {
    target: string;
    spec: RuleSpec;
}

interface RowLook {
    indent?: number;
    background?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    lineTop?: boolean;
    lineBottom?: boolean;
    doubleBottom?: boolean;
    lineColor?: string;
}
