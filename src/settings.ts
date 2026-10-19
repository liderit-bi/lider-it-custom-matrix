"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;

const color = (name: string, displayName: string, value: string) =>
    new formattingSettings.ColorPicker({ name, displayName, value: { value } });

class GeneralCard extends Card {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fuente", value: "Segoe UI, wf_segoe-ui_normal, helvetica, arial, sans-serif" });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Tamaño de texto", value: 10 });
    fontColor = color("fontColor", "Color de texto", "#252423");
    background = color("background", "Fondo", "#FFFFFF");
    gridColor = color("gridColor", "Líneas de cuadrícula", "#E6E6E6");
    bandedRows = new formattingSettings.ToggleSwitch({ name: "bandedRows", displayName: "Filas alternas", value: false });
    bandColor = color("bandColor", "Color de fila alterna", "#F7F7F7");
    cellFilterColumns = new formattingSettings.ToggleSwitch({ name: "cellFilterColumns", displayName: "Clic en celda: filtrar también por columna", value: true });

    name = "general";
    displayName = "General";
    slices = [this.fontFamily, this.fontSize, this.fontColor, this.background, this.gridColor, this.bandedRows, this.bandColor, this.cellFilterColumns];
}

export const widthModeItems: powerbi.IEnumMember[] = [
    { value: "content", displayName: "Ajustar al contenido" },
    { value: "fill", displayName: "Ajustar al ancho del visual" },
    { value: "fixed", displayName: "Ancho fijo" }
];

class ColumnHeadersCard extends Card {
    background = color("background", "Fondo", "#F3F2F1");
    fontColor = color("fontColor", "Color de texto", "#252423");
    bold = new formattingSettings.ToggleSwitch({ name: "bold", displayName: "Negrita", value: true });
    widthMode = new formattingSettings.ItemDropdown({ name: "widthMode", displayName: "Ancho de columnas", items: widthModeItems, value: widthModeItems[0] });
    fixedWidth = new formattingSettings.NumUpDown({ name: "fixedWidth", displayName: "Ancho fijo (px)", value: 100 });

    name = "columnHeaders";
    displayName = "Encabezados de columna";
    slices = [this.background, this.fontColor, this.bold, this.widthMode, this.fixedWidth];

    public refreshVisibility(): void {
        this.fixedWidth.visible = this.widthMode.value?.value === "fixed";
    }
}

class RowHeadersCard extends Card {
    showTitle = new formattingSettings.ToggleSwitch({ name: "showTitle", displayName: "Mostrar título", value: true });
    title = new formattingSettings.TextInput({ name: "title", displayName: "Título", value: "", placeholder: "Vacío = nombre del campo" });
    autoWidth = new formattingSettings.ToggleSwitch({ name: "autoWidth", displayName: "Ancho automático", value: true });
    width = new formattingSettings.NumUpDown({ name: "width", displayName: "Ancho (px)", value: 260 });
    indent = new formattingSettings.NumUpDown({ name: "indent", displayName: "Sangría por nivel (px)", value: 16 });
    boldGroups = new formattingSettings.ToggleSwitch({ name: "boldGroups", displayName: "Grupos en negrita", value: true });

    name = "rowHeaders";
    displayName = "Encabezados de fila";
    slices = [this.showTitle, this.title, this.autoWidth, this.width, this.indent, this.boldGroups];
}

const positionItems: powerbi.IEnumMember[] = [
    { value: "top", displayName: "En la fila del grupo" },
    { value: "bottom", displayName: "Fila al final del grupo" }
];

class SubTotalsCard extends Card {
    rowSubtotals = new formattingSettings.ToggleSwitch({ name: "rowSubtotals", displayName: "Subtotales de fila", value: true });
    columnSubtotals = new formattingSettings.ToggleSwitch({ name: "columnSubtotals", displayName: "Subtotales de columna", value: true });
    position = new formattingSettings.ItemDropdown({ name: "position", displayName: "Posición del subtotal", items: positionItems, value: positionItems[0] });
    showGrandTotal = new formattingSettings.ToggleSwitch({ name: "showGrandTotal", displayName: "Total general", value: true });
    grandTotalBackground = color("grandTotalBackground", "Fondo del total general", "#E1E1E1");
    grandTotalFontColor = color("grandTotalFontColor", "Texto del total general", "#252423");

    name = "subTotals";
    displayName = "Subtotales";
    slices = [this.rowSubtotals, this.columnSubtotals, this.position, this.showGrandTotal, this.grandTotalBackground, this.grandTotalFontColor];
}

class RowStylesCard extends Card {
    headerBackground = color("headerBackground", "Cabecera: fondo", "#DCE6F1");
    headerFontColor = color("headerFontColor", "Cabecera: texto", "#1F3864");
    subtotalBackground = color("subtotalBackground", "Subtotal: fondo", "#F2F2F2");
    subtotalFontColor = color("subtotalFontColor", "Subtotal: texto", "#252423");
    totalBackground = color("totalBackground", "Total: fondo", "#1F3864");
    totalFontColor = color("totalFontColor", "Total: texto", "#FFFFFF");
    lineColor = color("lineColor", "Color de línea", "#605E5C");

    name = "rowStyles";
    displayName = "Estilos de fila";
    slices = [this.headerBackground, this.headerFontColor, this.subtotalBackground, this.subtotalFontColor, this.totalBackground, this.totalFontColor, this.lineColor];
}

/** Formato de valores efectivo para una medida. */
export const iconStyleItems: powerbi.IEnumMember[] = [
    { value: "circle", displayName: "Círculo ✓ ✕" },
    { value: "arrow", displayName: "Flecha ▲ ▼" },
    { value: "dot", displayName: "Punto ●" }
];

export interface ValueFormat {
    clampOn: boolean;
    clampLimit: number;
    showIcons: boolean;
    iconStyle: string;
    negativeRed: boolean;
    negativeColor: string;
    positiveOn: boolean;
    positiveColor: string;
    negativeParentheses: boolean;
    blankAsDash: boolean;
}

/** Juego de ajustes de valores; uno general y uno por medida (selector de metadatos). */
export class ValueFormatSlices {
    clampOn: formattingSettings.ToggleSwitch;
    clampLimit: formattingSettings.NumUpDown;
    showIcons: formattingSettings.ToggleSwitch;
    iconStyle: formattingSettings.ItemDropdown;
    negativeRed: formattingSettings.ToggleSwitch;
    negativeColor: formattingSettings.ColorPicker;
    positiveOn: formattingSettings.ToggleSwitch;
    positiveColor: formattingSettings.ColorPicker;
    negativeParentheses: formattingSettings.ToggleSwitch;
    blankAsDash: formattingSettings.ToggleSwitch;

    constructor(base: ValueFormat, selector?: powerbi.data.Selector) {
        const sel = selector ? { selector } : {};
        this.clampOn = new formattingSettings.ToggleSwitch({ name: "clampOn", displayName: "Limitar porcentaje", value: base.clampOn, ...sel });
        this.clampLimit = new formattingSettings.NumUpDown({ name: "clampLimit", displayName: "Límite ± (%)", value: base.clampLimit, ...sel });
        this.showIcons = new formattingSettings.ToggleSwitch({ name: "showIcons", displayName: "Icono de positivo/negativo", value: base.showIcons, ...sel });
        const style = iconStyleItems.find(i => i.value === base.iconStyle) || iconStyleItems[0];
        this.iconStyle = new formattingSettings.ItemDropdown({ name: "iconStyle", displayName: "Tipo de icono", items: iconStyleItems, value: style, ...sel });
        this.negativeRed = new formattingSettings.ToggleSwitch({ name: "negativeRed", displayName: "Colorear negativos", value: base.negativeRed, ...sel });
        this.negativeColor = new formattingSettings.ColorPicker({ name: "negativeColor", displayName: "Color de negativos", value: { value: base.negativeColor }, ...sel });
        this.positiveOn = new formattingSettings.ToggleSwitch({ name: "positiveOn", displayName: "Colorear positivos", value: base.positiveOn, ...sel });
        this.positiveColor = new formattingSettings.ColorPicker({ name: "positiveColor", displayName: "Color de positivos", value: { value: base.positiveColor }, ...sel });
        this.negativeParentheses = new formattingSettings.ToggleSwitch({ name: "negativeParentheses", displayName: "Negativos entre paréntesis", value: base.negativeParentheses, ...sel });
        this.blankAsDash = new formattingSettings.ToggleSwitch({ name: "blankAsDash", displayName: "Vacíos como guion", value: base.blankAsDash, ...sel });
        this.refreshVisibility();
    }

    get list(): formattingSettings.Slice[] {
        return [this.negativeRed, this.negativeColor, this.positiveOn, this.positiveColor, this.showIcons, this.iconStyle,
            this.clampOn, this.clampLimit, this.negativeParentheses, this.blankAsDash];
    }

    refreshVisibility(): void {
        this.negativeColor.visible = this.negativeRed.value;
        this.positiveColor.visible = this.positiveOn.value;
        this.iconStyle.visible = this.showIcons.value;
        this.clampLimit.visible = this.clampOn.value;
    }

    get value(): ValueFormat {
        return {
            clampOn: this.clampOn.value, clampLimit: Number(this.clampLimit.value) || 100,
            showIcons: this.showIcons.value, iconStyle: String(this.iconStyle.value?.value || "circle"),
            negativeRed: this.negativeRed.value, negativeColor: this.negativeColor.value.value,
            positiveOn: this.positiveOn.value, positiveColor: this.positiveColor.value.value,
            negativeParentheses: this.negativeParentheses.value, blankAsDash: this.blankAsDash.value
        };
    }
}

export const defaultValueFormat: ValueFormat = {
    clampOn: false, clampLimit: 100, showIcons: false, iconStyle: "circle",
    negativeRed: false, negativeColor: "#C4314B", positiveOn: false, positiveColor: "#107C10",
    negativeParentheses: false, blankAsDash: false
};

class ValuesFormatCard extends Card {
    general = new ValueFormatSlices(defaultValueFormat);

    name = "valuesFormat";
    displayName = "Valores";
    container: formattingSettings.Container = new formattingSettings.Container({
        displayName: "Aplicar a",
        containerItems: [{ displayName: "(Todas las medidas)", slices: this.general.list }]
    });
}

/* ---------- Formato por fila ---------- */

const rowFormatModeItems: powerbi.IEnumMember[] = [
    { value: "text", displayName: "Texto de la fila" },
    { value: "field", displayName: "Campo de condición" }
];

const operatorItems: powerbi.IEnumMember[] = [
    { value: "eq", displayName: "=" },
    { value: "ne", displayName: "≠" },
    { value: "gt", displayName: ">" },
    { value: "ge", displayName: "≥" },
    { value: "lt", displayName: "<" },
    { value: "le", displayName: "≤" },
    { value: "contains", displayName: "contiene" }
];

export const noFieldItem: powerbi.IEnumMember = { value: "", displayName: "(Añade un campo a «Campos de condición»)" };

export class RowFormatCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Activar", value: false });
    mode = new formattingSettings.ItemDropdown({ name: "mode", displayName: "Elegir filas por", items: rowFormatModeItems, value: rowFormatModeItems[0] });
    rows = new formattingSettings.TextInput({ name: "rows", displayName: "Filas (separadas por ;)", value: "", placeholder: "Producción; Margen Bruto; Total*" });
    field = new formattingSettings.ItemDropdown({ name: "field", displayName: "Campo", items: [noFieldItem], value: noFieldItem });
    operator = new formattingSettings.ItemDropdown({ name: "operator", displayName: "Condición", items: operatorItems, value: operatorItems[0] });
    value = new formattingSettings.TextInput({ name: "value", displayName: "Valor", value: "", placeholder: "p. ej. 1" });
    useBackground = new formattingSettings.ToggleSwitch({ name: "useBackground", displayName: "Cambiar fondo", value: true });
    background = color("background", "Fondo", "#4472C4");
    useFontColor = new formattingSettings.ToggleSwitch({ name: "useFontColor", displayName: "Cambiar color de texto", value: true });
    fontColor = color("fontColor", "Color de texto", "#FFFFFF");
    bold = new formattingSettings.ToggleSwitch({ name: "bold", displayName: "Negrita", value: false });
    italic = new formattingSettings.ToggleSwitch({ name: "italic", displayName: "Cursiva", value: false });
    lineTop = new formattingSettings.ToggleSwitch({ name: "lineTop", displayName: "Línea superior", value: false });
    indent = new formattingSettings.NumUpDown({ name: "indent", displayName: "Sangría (niveles)", value: 0 });

    slices: formattingSettings.Slice[] = [this.mode, this.rows, this.field, this.operator, this.value, this.useBackground, this.background, this.useFontColor, this.fontColor, this.bold, this.italic, this.lineTop, this.indent];
    topLevelSlice = this.show;

    constructor(name: string, displayName: string) {
        super();
        this.name = name;
        this.displayName = displayName;
    }

    public refreshVisibility(): void {
        const byField = this.mode.value?.value === "field";
        this.rows.visible = !byField;
        [this.field, this.operator, this.value].forEach(sl => sl.visible = byField);
        this.background.visible = this.useBackground.value;
        this.fontColor.visible = this.useFontColor.value;
    }
}

export const ROW_FORMAT_COUNT = 6;

/* ---------- Formato condicional ---------- */

export const ALL_MEASURES = "*";
export const allMeasuresItem: powerbi.IEnumMember = { value: ALL_MEASURES, displayName: "(Todas las medidas)" };

const ruleKindItems: powerbi.IEnumMember[] = [
    { value: "scale", displayName: "Escala de color" },
    { value: "thresholds", displayName: "Umbrales (semáforo)" },
    { value: "bars", displayName: "Barras de datos" }
];

const applyToItems: powerbi.IEnumMember[] = [
    { value: "background", displayName: "Fondo de la celda" },
    { value: "font", displayName: "Color del texto" },
    { value: "icon", displayName: "Icono ▲ ● ▼" }
];

export class RuleCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Activar", value: false });
    target = new formattingSettings.ItemDropdown({ name: "target", displayName: "Medida", items: [allMeasuresItem], value: allMeasuresItem });
    kind = new formattingSettings.ItemDropdown({ name: "kind", displayName: "Tipo de regla", items: ruleKindItems, value: ruleKindItems[1] });
    applyTo = new formattingSettings.ItemDropdown({ name: "applyTo", displayName: "Aplicar a", items: applyToItems, value: applyToItems[0] });
    includeTotals = new formattingSettings.ToggleSwitch({ name: "includeTotals", displayName: "Incluir subtotales y totales", value: false });

    // Escala
    minColor = color("minColor", "Color del mínimo", "#F8696B");
    useMid = new formattingSettings.ToggleSwitch({ name: "useMid", displayName: "Usar color central", value: true });
    midValue = new formattingSettings.NumUpDown({ name: "midValue", displayName: "Valor central", value: 0 });
    midColor = color("midColor", "Color central", "#FFFFFF");
    maxColor = color("maxColor", "Color del máximo", "#63BE7B");

    // Umbrales
    percent = new formattingSettings.ToggleSwitch({ name: "percent", displayName: "Umbrales en %", value: false });
    lowLimit = new formattingSettings.NumUpDown({ name: "lowLimit", displayName: "Rojo si es menor que", value: 0 });
    highLimit = new formattingSettings.NumUpDown({ name: "highLimit", displayName: "Verde si es mayor o igual que", value: 0 });
    lowColor = color("lowColor", "Color bajo", "#F8D7DA");
    colorMiddle = new formattingSettings.ToggleSwitch({ name: "colorMiddle", displayName: "Colorear tramo intermedio", value: false });
    middleColor = color("middleColor", "Color intermedio", "#FFF4CE");
    highColor = color("highColor", "Color alto", "#DFF6DD");

    // Barras
    barPositive = color("barPositive", "Barra positiva", "#9DC3E6");
    barNegative = color("barNegative", "Barra negativa", "#F4B6B6");

    slices: formattingSettings.Slice[] = [
        this.target, this.kind, this.applyTo, this.includeTotals,
        this.minColor, this.useMid, this.midValue, this.midColor, this.maxColor,
        this.percent, this.lowLimit, this.highLimit, this.lowColor, this.colorMiddle, this.middleColor, this.highColor,
        this.barPositive, this.barNegative
    ];
    topLevelSlice = this.show;

    constructor(name: string, displayName: string) {
        super();
        this.name = name;
        this.displayName = displayName;
    }

    /** Muestra solo los ajustes del tipo de regla elegido. */
    public refreshVisibility(): void {
        const kind = this.kind.value?.value;
        const scale = kind === "scale", thr = kind === "thresholds", bars = kind === "bars";
        this.applyTo.visible = !bars;
        [this.minColor, this.useMid, this.maxColor].forEach(sl => sl.visible = scale);
        [this.midValue, this.midColor].forEach(sl => sl.visible = scale && this.useMid.value);
        [this.percent, this.lowLimit, this.highLimit, this.lowColor, this.colorMiddle, this.highColor].forEach(sl => sl.visible = thr);
        this.middleColor.visible = thr && this.colorMiddle.value;
        [this.barPositive, this.barNegative].forEach(sl => sl.visible = bars);
    }
}

class CellStyleCard extends Card {
    target = new formattingSettings.ItemDropdown({ name: "target", displayName: "Aplicar a la medida", items: [allMeasuresItem], value: allMeasuresItem });

    name = "cellStyle";
    displayName = "Formato de celda (medida)";
    slices = [this.target];
}

export const RULE_COUNT = 3;

export class VisualFormattingSettingsModel extends Model {
    general = new GeneralCard();
    columnHeaders = new ColumnHeadersCard();
    rowHeaders = new RowHeadersCard();
    subTotals = new SubTotalsCard();
    rowStyles = new RowStylesCard();
    valuesFormat = new ValuesFormatCard();
    rowFormats: RowFormatCard[] = Array.from({ length: ROW_FORMAT_COUNT }, (_, i) => new RowFormatCard(`rowFormat${i + 1}`, `Formato de filas ${i + 1}`));
    rules: RuleCard[] = Array.from({ length: RULE_COUNT }, (_, i) => new RuleCard(`cfRule${i + 1}`, `Formato condicional ${i + 1}`));
    cellStyle = new CellStyleCard();

    cards: Card[] = [this.general, this.columnHeaders, this.rowHeaders, this.subTotals, this.rowStyles, ...this.rowFormats, this.valuesFormat, ...this.rules, this.cellStyle];
}
