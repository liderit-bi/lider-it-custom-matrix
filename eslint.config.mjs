import powerbiVisualsConfigs from "eslint-plugin-powerbi-visuals";

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        ignores: ["harness/**", "node_modules/**", "dist/**", ".vscode/**", ".tmp/**"],
    },
];