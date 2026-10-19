# LIDER IT Custom Matrix — v1.12.0.0

Visual personalizado de Power BI para informes financieros. Hace lo que la matriz estándar no hace:
formatear la fila **completa**, incluido el encabezado de fila, manteniendo expandir/contraer filas y columnas y la obtención de detalles.

## Desarrollo

Requisitos: [Node.js](https://nodejs.org) 18 o superior, [Visual Studio Code](https://code.visualstudio.com) y Git.

```bash
npm install -g powerbi-visuals-tools   # herramienta pbiviz (global, no va en package.json)
npm install                            # dependencias del proyecto
npm run lint                           # ESLint con las reglas de Power BI
npm run package                        # genera dist/*.pbiviz
npm run audit:cert                     # empaqueta y revisa llamadas no permitidas (fetch, eval…)
npm run preview                        # genera preview.html con el banco de pruebas (sin Power BI)
```

Para depurar en vivo dentro del servicio de Power BI: `pbiviz start` y activar el modo desarrollador
(Configuración › Desarrollador) para usar el visual de desarrollador.

Probar en Desktop: panel Visualizaciones › `...` › **Importar un objeto visual desde un archivo** › `dist/*.pbiviz`.

### Publicar en GitHub

El proyecto ya trae Git inicializado con dos ramas: `main` (desarrollo) y `certification`
(la que revisa Microsoft; su código debe coincidir exactamente con el paquete enviado a Partner Center).

```bash
git remote add origin https://github.com/<organizacion>/lider-it-custom-matrix.git
git push -u origin main
git push -u origin certification
```

Antes de cada envío a Partner Center: subir la versión en `pbiviz.json` y `package.json`,
`npm run package`, fusionar `main` en `certification`, subir ambas ramas y enviar ese mismo `.pbiviz`.

## Campos

| Campo | Uso |
|---|---|
| Filas | Jerarquía de cuentas (p. ej. Grupo › Subgrupo › Cuenta). Expandir/contraer y obtención de detalles. |
| Columnas | Periodos, escenarios… Cada grupo con subtotal se puede contraer desde su encabezado. |
| Valores | Una o varias medidas. Se respeta la cadena de formato de cada medida. |
| Estilo de fila | (Opcional) Medida de texto que devuelve el estilo de cada fila. No se muestra como columna. |
| Formato de celda | (Opcional) Medida de texto evaluada en cada celda (fila × columna). No se muestra como columna. |
| Campos de condición | (Opcional, hasta 5) Campos que usan las tarjetas "Formato de filas" en modo "Campo de condición". |

## Medida "Estilo de fila"

Tokens separados por `;`:

| Token | Efecto |
|---|---|
| `header`, `subtotal`, `total` | Estilos predefinidos (colores en el panel *Estilos de fila*) |
| `bold`, `italic`, `underline` | Tipografía |
| `bg=#RRGGBB`, `color=#RRGGBB` | Fondo y texto de toda la fila, encabezado incluido |
| `line-top`, `line-bottom`, `double-bottom` | Líneas de separación |
| `indent=n` | Sangría adicional (niveles) |
| `sign=-1` | Invierte el signo de los valores de la fila |
| `blank` | Fila sin valores (títulos de sección) |
| `hide` | Oculta la fila |

Ejemplo con una tabla de estructura `Estructura[Cuenta]`, `Estructura[Estilo]`:

```DAX
Estilo fila =
SWITCH (
    TRUE (),
    ISINSCOPE ( Estructura[Cuenta] ), SELECTEDVALUE ( Estructura[EstiloCuenta] ),
    ISINSCOPE ( Estructura[Grupo] ),  SELECTEDVALUE ( Estructura[EstiloGrupo], "subtotal;line-top" ),
    "total;double-bottom"
)
```

## Panel de formato

General · Encabezados de columna · Encabezados de fila (ancho, sangría, grupos en negrita) ·
Subtotales (filas/columnas, posición arriba o abajo, total general) · Estilos de fila · Valores (negativos en rojo / entre paréntesis, vacíos como guion).

## Formato de filas sin DAX ("Formato de filas 1 a 6")

Para listados de un solo nivel o cuando no se quiere crear la medida "Estilo de fila".
Cada tarjeta aplica un formato a las filas cuyo nombre aparece en "Filas", separadas por `;`.

- No distingue mayúsculas ni acentos: `margen bruto` coincide con "Margen Bruto".
- `*` hace de comodín: `Total*` (empieza por), `*Indirecto` (termina en), `*Coste*` (contiene).
- Ajustes: fondo, color de texto, negrita, cursiva, línea superior y sangría en niveles.
- Los espacios al principio del texto del epígrafe se respetan, así que la sangría puede venir del propio dato del modelo.
  Para buscar la fila no hace falta escribir esos espacios.
- "Elegir filas por": **Texto de la fila** (lo anterior) o **Campo de condición**. En el segundo caso se arrastran
  uno o varios campos del modelo (p. ej. `Esquemas[Indentacion]`, `Categoria`) al campo "Campos de condición" del visual
  y en la tarjeta se elige Campo, Condición (=, ≠, >, ≥, <, ≤, contiene) y Valor. Compara como número si ambos lo son;
  si no, como texto sin mayúsculas ni acentos. Los campos de condición no se muestran como columnas.
  Conviene poner su agregación en Máximo o Mínimo (no Suma) para que no se acumule si hay varias filas por epígrafe.
- Prioridad: estilo por defecto → medida "Estilo de fila" → tarjetas de formato de filas (la de número mayor gana).

## Selección y obtención de detalles

- Clic o clic derecho en el **encabezado de fila**: filtra solo por la fila (p. ej. Epígrafe).
- Clic o clic derecho en una **celda de valor**: filtra por la fila y por los grupos de columna de esa celda
  (p. ej. Epígrafe + CompanyName), igual que la matriz nativa. "Obtener detalles" recibe ambos filtros.
- Celdas de columnas de total: solo pasan la fila; en la fila de total general, solo la columna.
- "General › Clic en celda: filtrar también por columna" (activado por defecto): si se desactiva, las celdas
  pasan solo la fila, como el encabezado de fila. Útil si "Obtener detalles" no aparece en las celdas.

## Título de la columna de filas

"Encabezados de fila › Mostrar título" y "Título": vacío muestra el nombre del campo (p. ej. "Epígrafe"),
un texto lo sustituye y desactivando "Mostrar título" la celda queda en blanco.

## Ancho de columnas

- "Encabezados de columna › Ancho de columnas": ajustar al contenido, ajustar al ancho del visual o ancho fijo.
- "Encabezados de fila › Ancho automático": la primera columna se ajusta a la etiqueta más larga.
- Arrastrando el borde derecho de un encabezado se fija el ancho de esa columna a mano; se guarda en el informe.
  Doble clic sobre el borde la devuelve al ajuste automático.

## Formato de valores por medida

La tarjeta "Valores" tiene un selector "Aplicar a": "(Todas las medidas)" o una medida concreta.
Lo que se ajusta en una medida tiene prioridad sobre el general. Ajustes: colorear negativos (y su color),
colorear positivos (y su color), icono de positivo/negativo a la derecha del valor (círculo ✓ ✕, flecha ▲ ▼ o punto ●,
con los colores de positivos y negativos; el cero no lleva icono), limitar porcentaje a ±N % (por defecto ±100 %:
el valor mostrado y el que usan las reglas no pasan de ese límite), negativos entre paréntesis y vacíos como guion.
En filas con color de texto propio (cabeceras, totales, filas formateadas) se respeta el color de la fila.

## Formato condicional

Power BI no ofrece el botón fx a los visuales personalizados basados en matriz, así que el visual trae su propio sistema.

### Reglas del panel ("Formato condicional 1, 2 y 3")

Cada tarjeta es una regla independiente; si dos coinciden en una celda, gana la de número mayor.

| Ajuste | Uso |
|---|---|
| Activar | Interruptor de la tarjeta. |
| Medida | A qué medida de Valores se aplica, o "(Todas las medidas)". |
| Tipo de regla | Escala de color, Umbrales (semáforo) o Barras de datos. |
| Aplicar a | Fondo de la celda, color del texto o icono ▲ ● ▼. |
| Incluir subtotales y totales | Desactivado por defecto: las filas y columnas de total no se colorean ni cuentan para el mínimo/máximo. |

- **Escala**: color del mínimo y del máximo; opcionalmente un color central en un valor fijo (por defecto 0).
- **Umbrales**: bajo si el valor es menor que el primer límite, alto si es mayor o igual que el segundo, intermedio en medio (opcional). "Umbrales en %" permite escribir 5 en lugar de 0,05.
- **Barras**: barra proporcional con eje en cero; colores separados para positivos y negativos.

Los colores por defecto son tonos suaves para fondo; con "Color del texto" o "Icono" se usan automáticamente sus equivalentes intensos.

### Medida "Formato de celda"

Para la lógica que no cabe en una regla. Se evalúa en cada celda, así que puede usar el contexto de fila y columna. Tokens separados por `;`:

| Token | Efecto |
|---|---|
| `bg=#RRGGBB` | Fondo de la celda |
| `color=#RRGGBB` | Color del texto |
| `bold`, `italic` | Negrita, cursiva |
| `icon=up\|down\|right\|dot` | Icono delante del valor |
| `icon-color=#RRGGBB` | Color del icono |

En la tarjeta "Formato de celda (medida)" se elige a qué medida se aplica.

```DAX
Formato celda =
VAR Desv = DIVIDE ( [Real] - [Presupuesto], ABS ( [Presupuesto] ) )
RETURN
    SWITCH (
        TRUE (),
        Desv < -0.05, "color=#C4314B;bold",
        Desv > 0.05, "icon=up;icon-color=#107C10",
        BLANK ()
    )
```

Orden de prioridad: estilo de fila → reglas del panel → medida "Formato de celda".
En alto contraste se ignoran los colores condicionales.

## Ya preparado para la certificación

- Sin acceso a red (`privileges: []`), sin `innerHTML` ni `eval`, sin librerías de terceros en tiempo de ejecución.
- ESLint con `eslint-plugin-powerbi-visuals` sin errores; `npm audit` sin vulnerabilidades.
- Eventos de renderizado, menú contextual, selección y filtrado cruzado, página de inicio, foco de teclado, alto contraste, respeto de *permitir interacciones*, fetchMoreData.

## Pendiente antes de enviar a AppSource

1. Sustituir `<organizacion>` en `pbiviz.json` y `package.json` por la organización real de GitHub, y poner en
   `supportUrl` la página de soporte de LIDER IT.
2. Política de privacidad publicada en la web de LIDER IT.
3. Informe `.pbix` de ejemplo con datos importados (sin conexiones externas) y la misma versión del visual.
4. Partner Center: ficha, logo, capturas, `.pbiviz` + `.pbix`, casilla "Request Power BI certification" y,
   en "Notes for certification", el enlace al repositorio.
5. Siguientes funciones: tooltips, resaltado, localización y exportación a Excel con formato.

## Estructura

```
capabilities.json   roles, mapeo matriz, expandCollapse, drilldown, subtotales, objetos del panel
src/visual.ts       render de la tabla, interacción, formato
src/model.ts        árbol de columnas y aplanado de filas desde el dataView de matriz
src/rowStyle.ts     parser de la medida "Estilo de fila"
src/conditional.ts  formato condicional (reglas del panel y medida "Formato de celda")
src/settings.ts     panel de formato
harness/            banco de pruebas: el visual real con un host de Power BI simulado y datos de ejemplo
style/visual.less   estilos
```
