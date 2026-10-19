"use strict";

import powerbi from "powerbi-visuals-api";
import DataViewMatrix = powerbi.DataViewMatrix;
import DataViewMatrixNode = powerbi.DataViewMatrixNode;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;

/* ---------- Columnas ---------- */

export interface ColLeaf {
    valueIndex: number;   // clave en node.values de las filas
    measureIndex: number; // índice en matrix.valueSources
    /** Clave en node.values de la medida "Formato de celda" de la misma columna. */
    cellStyleIndex?: number;
    /** La columna es un subtotal o el total general. */
    isTotal?: boolean;
    /** Clave estable de la columna (para anchos guardados). */
    key?: string;
    /** Nodos de columna (sin subtotales ni nivel de medidas) que identifican la columna para filtros y obtención de detalles. */
    columnPath?: DataViewMatrixNode[];
}

export interface ColNode {
    key: string;
    label: string;
    isSubtotal: boolean;
    isMeasureLevel: boolean;
    children: ColNode[];
    leaf?: ColLeaf;
}

export type LabelFormatter = (value: powerbi.PrimitiveValue, source: DataViewMetadataColumn | undefined) => string;

export const TOTAL_LABEL = "Total";

function nodeLabel(node: DataViewMatrixNode, level: powerbi.DataViewHierarchyLevel | undefined, fmt: LabelFormatter): string {
    if (node.isSubtotal) {
        return TOTAL_LABEL;
    }
    const parts = (node.levelValues || []).map(lv => fmt(lv.value, level?.sources[lv.levelSourceIndex]));
    if (parts.length) {
        return parts.join(" ");
    }
    return fmt(node.value, level?.sources[node.levelSourceIndex || 0]);
}

export function buildColumnTree(matrix: DataViewMatrix, styleMeasureIndex: number, cellStyleMeasureIndex: number, fmt: LabelFormatter): ColNode {
    const hidden = (i: number) => i === styleMeasureIndex || i === cellStyleMeasureIndex
        || !!matrix.valueSources[i]?.roles?.["conditionFields"];
    const levels = matrix.columns.levels || [];
    const isMeasureLevel = (depth: number) => {
        const lvl = levels[depth];
        return !!lvl && lvl.sources.length > 0 && lvl.sources.every(s => s.isMeasure);
    };
    const measureIndexOf = (src: DataViewMetadataColumn | undefined): number => {
        if (!src) { return 0; }
        const i = matrix.valueSources.findIndex(v => v.queryName === src.queryName);
        return i < 0 ? 0 : i;
    };

    let leafCounter = 0;
    const visit = (node: DataViewMatrixNode, depth: number, parentKey: string, path: DataViewMatrixNode[]): ColNode => {
        // Se usa el nivel real del nodo: bajo un subtotal la profundidad del recorrido no coincide con el nivel.
        const lvlIndex = depth < 0 ? -1 : (typeof node.level === "number" ? node.level : depth);
        const measureLevel = lvlIndex >= 0 && isMeasureLevel(lvlIndex);
        const level = lvlIndex >= 0 ? levels[lvlIndex] : undefined;
        const label = depth < 0 ? "" : (measureLevel
            ? (level?.sources[node.levelSourceIndex || 0]?.displayName || "")
            : nodeLabel(node, level, fmt));
        const key = depth < 0 ? "root" : `${parentKey}|${node.isSubtotal ? "#T" : label}`;
        const col: ColNode = { key, label, isSubtotal: !!node.isSubtotal, isMeasureLevel: measureLevel, children: [] };
        // Solo los nodos de grupo reales aportan identidad (no la raíz, los subtotales ni las medidas).
        const ownPath = depth >= 0 && !node.isSubtotal && !measureLevel && node.identity ? [...path, node] : path;
        if (node.children && node.children.length) {
            col.children = node.children.map(c => visit(c, depth + 1, key, ownPath));
            const cellStyle = col.children.find(c => c.leaf && c.leaf.measureIndex === cellStyleMeasureIndex);
            if (cellStyle) {
                col.children.forEach(c => { if (c.leaf && c !== cellStyle) { c.leaf.cellStyleIndex = cellStyle.leaf!.valueIndex; } });
            }
        } else if (depth >= 0) {
            const measureIndex = measureLevel
                ? measureIndexOf(level?.sources[node.levelSourceIndex || 0])
                : firstDisplayMeasure(matrix, hidden);
            col.leaf = { valueIndex: leafCounter++, measureIndex, columnPath: ownPath };
        }
        return col;
    };
    const root = visit(matrix.columns.root, -1, "", []);

    // Quitar la medida de estilo de las columnas visibles.
    const prune = (n: ColNode): ColNode | null => {
        if (n.leaf) {
            return hidden(n.leaf.measureIndex) ? null : n;
        }
        const kids = n.children.map(prune).filter((c): c is ColNode => c !== null);
        if (!kids.length) { return null; }
        return { ...n, children: kids };
    };
    const pruned = prune(root) || { ...root, children: [] };

    // Con una sola medida visible, el nivel de medidas no aporta: se pliega en su padre.
    const displayMeasures = matrix.valueSources.filter((_, i) => !hidden(i)).length;
    if (displayMeasures === 1) {
        const fold = (n: ColNode): ColNode => {
            if (n.children.length === 1 && n.children[0].isMeasureLevel && n.children[0].leaf) {
                // Sin grupos de columna (raíz), el encabezado es el nombre de la medida, como en la matriz nativa.
                const label = n.key === "root" ? n.children[0].label : n.label;
                return { ...n, label, children: [], leaf: n.children[0].leaf };
            }
            return { ...n, children: n.children.map(fold) };
        };
        return fold(pruned);
    }
    return pruned;
}

function firstDisplayMeasure(matrix: DataViewMatrix, hidden: (i: number) => boolean): number {
    const i = matrix.valueSources.findIndex((_, idx) => !hidden(idx));
    return i < 0 ? 0 : i;
}

/** Vista de columnas aplicando el estado plegado de los grupos. */
export interface ColView {
    key: string;
    label: string;
    isSubtotal: boolean;
    toggle: "expand" | "collapse" | null;
    children: ColView[];
    leaf?: ColLeaf;
}

export function buildColumnView(root: ColNode, collapsed: Set<string>, showSubtotals: boolean): ColView[] {
    const toView = (n: ColNode): ColView => {
        if (!n.children.length) {
            return { key: n.key, label: n.label, isSubtotal: n.isSubtotal, toggle: null, children: [], leaf: n.leaf };
        }
        const sub = n.children.find(c => c.isSubtotal);
        const real = n.children.filter(c => !c.isSubtotal);
        if (sub && collapsed.has(n.key)) {
            if (!sub.children.length) {
                return { key: n.key, label: n.label, isSubtotal: false, toggle: "expand", children: [], leaf: sub.leaf };
            }
            return { key: n.key, label: n.label, isSubtotal: false, toggle: "expand", children: sub.children.map(toView) };
        }
        const kids = real.map(toView);
        if (sub && showSubtotals) {
            const subView = toView(sub);
            subView.label = `${TOTAL_LABEL} ${n.label}`.trim();
            kids.push(subView);
        }
        return { key: n.key, label: n.label, isSubtotal: n.isSubtotal, toggle: sub ? "collapse" : null, children: kids };
    };

    if (root.leaf) {
        return [{ key: root.key, label: root.label, isSubtotal: false, toggle: null, children: [], leaf: root.leaf }];
    }
    const sub = root.children.find(c => c.isSubtotal);
    const views = root.children.filter(c => !c.isSubtotal).map(toView);
    if (sub && showSubtotals) {
        const total = toView(sub);
        total.label = TOTAL_LABEL;
        views.push(total);
    }
    return views;
}

export function leavesOf(views: ColView[]): ColLeaf[] {
    const out: ColLeaf[] = [];
    const walk = (v: ColView, inTotal: boolean) => {
        const total = inTotal || v.isSubtotal;
        if (v.leaf && !v.children.length) { out.push({ ...v.leaf, isTotal: total, key: v.key }); return; }
        v.children.forEach(c => walk(c, total));
    };
    views.forEach(v => walk(v, false));
    return out;
}

/* ---------- Filas ---------- */

export type RowKind = "data" | "subtotal" | "grand";

export interface RowItem {
    node: DataViewMatrixNode;
    label: string;
    level: number;
    kind: RowKind;
    expandable: boolean;
    isCollapsed: boolean;
    values?: { [id: number]: powerbi.DataViewMatrixNodeValue };
    /** Valores de los que se lee la medida de estilo (para un grupo expandido, los de su subtotal). */
    styleValues?: { [id: number]: powerbi.DataViewMatrixNodeValue };
}

export function flattenRows(matrix: DataViewMatrix, subtotalPosition: "top" | "bottom", showGrandTotal: boolean, fmt: LabelFormatter): RowItem[] {
    const levels = matrix.rows.levels || [];
    const out: RowItem[] = [];

    const walk = (parent: DataViewMatrixNode) => {
        for (const child of parent.children || []) {
            if (child.isSubtotal) { continue; }
            const level = child.level || 0;
            const label = nodeLabel(child, levels[level], fmt);
            const kids = child.children || [];
            const expandable = child.isCollapsed !== undefined;
            if (kids.length) {
                const sub = kids.find(k => k.isSubtotal);
                out.push({
                    node: child, label, level, kind: "data", expandable, isCollapsed: false,
                    values: subtotalPosition === "top" ? sub?.values : undefined,
                    styleValues: sub?.values
                });
                walk(child);
                if (subtotalPosition === "bottom" && sub) {
                    out.push({ node: child, label: `${TOTAL_LABEL} ${label}`, level, kind: "subtotal", expandable: false, isCollapsed: false, values: sub.values });
                }
            } else {
                out.push({ node: child, label, level, kind: "data", expandable, isCollapsed: !!child.isCollapsed, values: child.values, styleValues: child.values });
            }
        }
    };
    walk(matrix.rows.root);

    if (showGrandTotal) {
        const grand = (matrix.rows.root.children || []).find(c => c.isSubtotal);
        if (grand) {
            out.push({ node: grand, label: TOTAL_LABEL, level: 0, kind: "grand", expandable: false, isCollapsed: false, values: grand.values, styleValues: grand.values });
        }
    }
    return out;
}
