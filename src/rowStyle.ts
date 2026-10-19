"use strict";

/**
 * Estilo de fila leído de la medida "Estilo de fila".
 * Formato: tokens separados por ";" — p. ej. "subtotal;line-top" o "bold;bg=#DCE6F1;color=#1F3864".
 */
export interface RowStyle {
    preset?: "header" | "subtotal" | "total";
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    background?: string;
    color?: string;
    lineTop?: boolean;
    lineBottom?: boolean;
    doubleBottom?: boolean;
    indent?: number;
    hide?: boolean;
    noExpand?: boolean;
    blankValues?: boolean;
    signFactor?: number;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseRowStyle(raw: unknown): RowStyle {
    const style: RowStyle = {};
    if (typeof raw !== "string" || raw.trim() === "") {
        return style;
    }
    for (const token of raw.split(";")) {
        const [keyRaw, valueRaw] = token.split("=");
        const key = (keyRaw || "").trim().toLowerCase();
        const value = (valueRaw || "").trim();
        switch (key) {
            case "header":
            case "subtotal":
            case "total":
                style.preset = key;
                break;
            case "bold": style.bold = true; break;
            case "italic": style.italic = true; break;
            case "underline": style.underline = true; break;
            case "line-top": style.lineTop = true; break;
            case "line-bottom": style.lineBottom = true; break;
            case "double-bottom": style.doubleBottom = true; break;
            case "hide": style.hide = true; break;
            case "noexpand": style.noExpand = true; break;
            case "blank": style.blankValues = true; break;
            case "bg":
                if (HEX.test(value)) { style.background = value; }
                break;
            case "color":
                if (HEX.test(value)) { style.color = value; }
                break;
            case "indent": {
                const n = Number(value);
                if (Number.isFinite(n)) { style.indent = Math.max(0, Math.min(10, n)); }
                break;
            }
            case "sign": {
                const n = Number(value);
                if (n === -1 || n === 1) { style.signFactor = n; }
                break;
            }
            default:
                break;
        }
    }
    return style;
}
