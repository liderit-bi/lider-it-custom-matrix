"use strict";

/**
 * Formato condicional de celdas: reglas del panel (escala, umbrales, barras)
 * y la medida "Formato de celda".
 */

export type IconKind = "up" | "down" | "right" | "dot";

export interface CellLook {
    background?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    icon?: IconKind;
    iconColor?: string;
    /** Barra de datos: inicio y ancho en % del ancho de la celda. */
    bar?: { left: number; width: number; color: string };
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ICONS: IconKind[] = ["up", "down", "right", "dot"];

/** Lee la medida "Formato de celda": tokens separados por ";". */
export function parseCellStyle(raw: unknown): CellLook {
    const look: CellLook = {};
    if (typeof raw !== "string" || raw.trim() === "") {
        return look;
    }
    for (const token of raw.split(";")) {
        const [keyRaw, valueRaw] = token.split("=");
        const key = (keyRaw || "").trim().toLowerCase();
        const value = (valueRaw || "").trim();
        switch (key) {
            case "bold": look.bold = true; break;
            case "italic": look.italic = true; break;
            case "bg": if (HEX.test(value)) { look.background = value; } break;
            case "color": if (HEX.test(value)) { look.color = value; } break;
            case "icon": {
                const v = value.toLowerCase() as IconKind;
                if (ICONS.indexOf(v) >= 0) { look.icon = v; }
                break;
            }
            case "icon-color": if (HEX.test(value)) { look.iconColor = value; } break;
            default: break;
        }
    }
    return look;
}

export interface RuleSpec {
    kind: "scale" | "thresholds" | "bars";
    applyTo: "background" | "font" | "icon";
    includeTotals: boolean;
    minColor: string; useMid: boolean; midValue: number; midColor: string; maxColor: string;
    low: number; high: number; lowColor: string; colorMiddle: boolean; middleColor: string; highColor: string;
    barPositive: string; barNegative: string;
}

export interface RuleStats { min: number; max: number; }

export function emptyStats(): RuleStats {
    return { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
}

export function addToStats(stats: RuleStats, v: number): void {
    if (v < stats.min) { stats.min = v; }
    if (v > stats.max) { stats.max = v; }
}

/** Aplica una regla a un valor y devuelve lo que cambia en la celda. */
export function evaluateRule(rule: RuleSpec, v: number, stats: RuleStats): CellLook {
    const look: CellLook = {};
    if (rule.kind === "bars") {
        if (!Number.isFinite(stats.min)) { return look; }
        const lo = Math.min(0, stats.min), hi = Math.max(0, stats.max);
        const span = hi - lo;
        if (span <= 0) { return look; }
        const zero = (-lo / span) * 100;
        const width = (Math.abs(v) / span) * 100;
        look.bar = v >= 0
            ? { left: zero, width, color: rule.barPositive }
            : { left: zero - width, width, color: rule.barNegative };
        return look;
    }

    let color: string | undefined;
    let icon: IconKind | undefined;
    if (rule.kind === "thresholds") {
        if (v < rule.low) { color = rule.lowColor; icon = "down"; }
        else if (v >= rule.high) { color = rule.highColor; icon = "up"; }
        else { color = rule.colorMiddle ? rule.middleColor : undefined; icon = "right"; }
    } else {
        color = scaleColor(rule, v, stats);
    }

    if (rule.applyTo === "icon") {
        look.icon = icon || "dot";
        look.iconColor = color || "#A19F9D";
    } else if (color) {
        if (rule.applyTo === "font") { look.color = color; } else { look.background = color; }
    }
    return look;
}

function scaleColor(rule: RuleSpec, v: number, stats: RuleStats): string | undefined {
    const { min, max } = stats;
    if (!Number.isFinite(min) || !Number.isFinite(max)) { return undefined; }
    if (rule.useMid) {
        const mid = rule.midValue;
        if (v <= mid) {
            return min < mid ? mix(rule.minColor, rule.midColor, (v - min) / (mid - min)) : rule.midColor;
        }
        return max > mid ? mix(rule.midColor, rule.maxColor, (v - mid) / (max - mid)) : rule.midColor;
    }
    if (max === min) { return mix(rule.minColor, rule.maxColor, 0.5); }
    return mix(rule.minColor, rule.maxColor, (v - min) / (max - min));
}

function toRgb(hex: string): [number, number, number] {
    let h = hex.replace("#", "");
    if (h.length === 3) { h = h.split("").map(c => c + c).join(""); }
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
    const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    const ca = toRgb(a), cb = toRgb(b);
    const c = ca.map((x, i) => Math.round(x + (cb[i] - x) * k));
    return "#" + c.map(x => x.toString(16).padStart(2, "0")).join("");
}

/** Texto legible sobre un fondo dado. */
export function readableOn(bg: string): string {
    const [r, g, b] = toRgb(bg);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#252423" : "#FFFFFF";
}

export const ICON_GLYPH: Record<IconKind, string> = { up: "▲", down: "▼", right: "►", dot: "●" };
