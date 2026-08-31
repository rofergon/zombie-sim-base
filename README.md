# The Outbreak

Una colección de simulaciones y juegos de supervivencia dibujados a mano sobre
papel. Las líneas tiemblan y se redibujan continuamente, el terreno se genera de
forma procedural y cientos de agentes comparten navegación, combate y física en
tiempo real.

El proyecto está hecho con JavaScript clásico, Canvas 2D y un compositor WebGL
opcional basado en Phaser. No usa framework, bundler ni paso de compilación: las
cuatro experiencias se pueden abrir directamente desde el sistema de archivos.

![La Zona: colonia sobre un mapa de papel](./Captura%20desde%202026-08-29%2016-18-06.png)

## Modos incluidos

| Página | Modo | Descripción |
| --- | --- | --- |
| [`index.html`](./index.html) | **El brote** | Una población intenta sobrevivir a oleadas de infectados en un pueblo procedural. Incluye refugios, escuadras de defensa, torretas, fuego, granadas y ataques de artillería. |
| [`battle.html`](./battle.html) | **Canas, 216 a. C.** | Recreación sistémica de la batalla de Cannas con 781 figuras, formaciones, caballería, moral, retirada y envolvimiento. |
| [`hold.html`](./hold.html) | **La Fortaleza** | Defensa de base sobre una cuadrícula de 40 × 30: excava el terreno, construye muros y edificios, mejora a los soldados y resiste noches de 90 segundos. |
| [`zone.html`](./zone.html) | **La Zona** | RTS de supervivencia y colonia con ciudadanos persistentes, trabajos, escuadras, saqueo, producción, fortificaciones, hordas y expediciones. Su campaña original Proyecto Aurora incluye rescates, facciones, comercio, leyes, una cura y finales alternativos. Puede usar mapas procedurales o cartografía real de OpenStreetMap. |

## Cómo ejecutarlo

No hay que instalar nada para jugar. Clona o descarga el repositorio y abre
`index.html` con un navegador moderno: el menú principal permite escoger entre
los cuatro modos y configurar sonido, volumen, cámara y pantalla. Cada modo
también conserva su propio archivo HTML para abrirlo directamente.

También puedes servir la carpeta localmente, opción recomendada para usar la
selección de mapas reales de La Zona:

```bash
python3 -m http.server 8000
```

Después visita:

- <http://localhost:8000/index.html>
- <http://localhost:8000/battle.html>
- <http://localhost:8000/hold.html>
- <http://localhost:8000/zone.html>

La Zona puede funcionar completamente sin conexión con un mapa procedural. La
búsqueda de lugares, la descarga de cartografía y el relieve requieren conexión
a internet; los datos geográficos proceden de OpenStreetMap y sus servicios
asociados.

## Controles

En todos los modos puedes arrastrar para mover la cámara, usar la rueda para
acercar o alejar y hacer un gesto de pinza en pantallas táctiles.

### El brote y Canas

- **El brote:** toca o haz clic en el terreno para pedir un ataque de
  artillería.
- **Canas:** toca o haz clic para reagrupar la línea aliada más cercana.

### La Fortaleza

- Clic izquierdo: excavar, construir o golpear infectados durante la noche.
- Clic derecho: desmontar una construcción y recuperar la mitad de su coste.
- `1`–`4`: agua, arena, camino y limpiar terreno.
- `B`, `G`, `Y`, `V`, `F`, `T`, `W`: muro, puerta, desguace, granja, cuartel,
  torreta y taller.
- `0` o `Esc`: guardar la herramienta y desplazar la cámara.

El panel lateral permite recoger chatarra, comprar mejoras, iniciar la noche y
reiniciar el asentamiento.

### La Zona

- Clic izquierdo o selección por arrastre: seleccionar ciudadanos y escuadras.
- Clic derecho: ordenar movimiento, entrada o saqueo según el objetivo.
- `Shift`: añadir órdenes a la cola; `Espacio` + arrastre: mover la cámara.
- `V`: saquear un área; `A`: atacar y avanzar; `G`: guarnecer.
- `R`: retirada; `H`: volver al cuartel general; `P`: patrullar; `S`: detenerse.
- `Ctrl`/`Cmd` + `1`–`9`: asignar grupos de control; `1`–`9`: recuperarlos.

La interfaz también expone estas órdenes, las velocidades `pausa`, `×1`, `×2`
y `×4`, los sistemas de colonia y las capas de información del mapa.

## Guardado

La Fortaleza y La Zona guardan la partida automáticamente en el almacenamiento
local del navegador. La Zona conserva sus MapPacks grandes en IndexedDB y
permite importarlos o exportarlos como JSON para utilizarlos sin conexión.

Los datos pertenecen al perfil y al origen actual del navegador. Por eso una
partida abierta mediante `file://` puede no aparecer al entrar después mediante
`http://localhost`.

## Arquitectura

Las páginas comparten un núcleo agnóstico del escenario. Cada archivo se carga
con etiquetas `<script>` clásicas y registra sus componentes en el espacio de
nombres global `window.ZS`; el orden de carga es parte del contrato y mantiene
el proyecto compatible con `file://`.

```text
index.html / battle.html / hold.html / zone.html
├── js/sketch.js, world.js, buildings.js   estilo y mundo de papel
├── js/grid.js, nav.js, camera.js          índice espacial, A* y cámara
├── js/agents.js, sim.js, draw.js          agentes, reloj y render
├── js/scenarios/                          reglas de cada modo
├── js/zone/                               sistemas persistentes de La Zona
└── js/phaser-renderer.js                  compositor WebGL de Hold y Zone
```

El aspecto de los agentes del brote es una portación fiel de
[`example/index.html`](./example/index.html), el prototipo monolítico original.
Los documentos [`OUTBREAK-DESIGN.md`](./OUTBREAK-DESIGN.md),
[`HOLD-DESIGN.md`](./HOLD-DESIGN.md) y [`ZONE-DESIGN.md`](./ZONE-DESIGN.md)
describen las decisiones, invariantes y planes de cada experiencia.

## Desarrollo y pruebas

Node.js solo es necesario para las herramientas de desarrollo. Instala las
dependencias reproducibles con:

```bash
npm ci
```

Comandos disponibles:

```bash
npm run format             # formatea js/ y tests/ con oxfmt
npm run lint               # analiza js/ y tests/ con oxlint
npm test                   # ejecuta toda la suite de Playwright
npm run test:menu          # valida el menú, ajustes y persistencia
npm run test:smoke         # abre y valida las cuatro páginas
npm run test:zone          # regresión base y migraciones de La Zona
npm run test:zone-workers  # ciudadanos, tareas y conservación de recursos
npm run test:zone-squads   # órdenes, patrullas, inventario y encuentros
npm run test:zone-colony   # producción, investigación y defensa nocturna
npm run test:zone-campaign # eventos, población, facciones, cura y finales
npm run test:zone-geo      # mapas, migraciones geográficas y expediciones
```

Si Playwright no encuentra un navegador compatible, instala Chromium una vez:

```bash
npx playwright install chromium
```

Antes de entregar cambios, `npm run format` y `npm run lint` deben terminar sin
advertencias ni errores. Los cambios visuales deben conservar la paleta de
papel y las primitivas de línea temblorosa de [`js/sketch.js`](./js/sketch.js).
