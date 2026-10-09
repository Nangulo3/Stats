# Volei · Match Tracker

App web (PWA, local-first) para registrar estadísticas de partidos de voleibol desde el celular: cancha 4–3–2 / 5–6–1, un toque en el jugador y otro en la acción, marcador independiente, sustituciones, líbero, historial con deshacer y resumen exportable.

## Requisitos

- Node.js 20.19+ (probado con Node 22) y npm.

## Ejecutar

```bash
npm install
npm run dev        # desarrollo en http://localhost:5173
```

Para usarla en el celular conectado a la misma red Wi-Fi, abre la URL `Network:` que imprime `npm run dev` (por ejemplo `http://192.168.1.20:5173`).

Versión de producción (con service worker para funcionar sin conexión):

```bash
npm run build
npm run preview    # sirve dist/ en http://localhost:4173
```

La carpeta `dist/` es estática: se puede publicar en GitHub Pages, Netlify, Vercel, etc. Para **instalarla** en el celular ("Agregar a pantalla de inicio") y usarla sin conexión el navegador exige HTTPS, así que lo más cómodo es publicarla en uno de esos servicios.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run lint` | Lint (oxlint) |
| `npm run build` | Typecheck + build de producción + service worker |
| `npm run preview` | Sirve el build |

## Estructura

```
src/
  domain/        Lógica pura, sin React ni almacenamiento
    types.ts       Modelo: Player, Match, MatchEvent (stat, score, substitution, libero, rotation, set_close, match_end)
    defaults.ts    Categorías y acciones iniciales + reglas de conteo
    lineup.ts      Rotación horaria y validación de alineación
    matchState.ts  Reconstruye marcador, set, cancha y líbero a partir de los eventos
    commands.ts    Comandos validados que producen eventos; deshacer/anular
    stats.ts       Agregación por jugador, set y equipo; métricas derivadas
    config.ts      Validación de acciones (doble conteo, ciclos…) y reordenamiento
    match.ts       Creación de partido y validación de jugadores
    backup.ts      Copia JSON versionada + CSV
  persistence/db.ts  IndexedDB (librería idb)
  state/store.ts     Store (zustand): aplica comandos y guarda en cada acción
  ui/                Pantallas y componentes (mobile-first)
```

## Decisiones de diseño

- **Todo es un evento.** Marcador, set actual, cancha y estadísticas se calculan desde los eventos válidos; no hay contadores paralelos que puedan divergir.
- **Deshacer = anular.** Un evento corregido queda marcado como anulado (con hora) y sigue visible en el historial.
  - Las estadísticas se pueden anular en cualquier momento.
  - Los puntos se pueden anular mientras su set siga abierto.
  - Sustituciones, líbero, rotaciones y cierres de set solo se pueden anular si son la última acción, para no dejar la cancha incoherente.
- **Instantáneas.** Cada evento guarda el marcador del instante, el set, la hora y la posición. También guarda una copia del jugador (número, nombre y rol) y de la acción (código, nombre, categoría y color). Así, editar un jugador o renombrar una acción no altera el historial.
- **Reglas de conteo configurables y fijadas al registrar.** Por defecto, Kills y Errors suman también Attempts, y SB y BE suman también Blocks. Los contadores aplicados quedan guardados en el evento, así que cambiar la regla después no reescribe partidos anteriores.
- **Marcador independiente.** Ninguna estadística suma puntos; el +1 es siempre manual.
- **Saque y rotación automáticos** (se pueden apagar al crear el partido).
  - El equipo que gana el rally saca. Solo rotamos (4→3, 3→2, 2→1, 1→6, 6→5, 5→4) cuando recuperamos el saque.
  - Primer saque: el set 1 se elige al crear el partido; en los siguientes saca primero quien no sacó primero en el anterior; antes del set decisivo la app pregunta (nuevo sorteo).
  - Cada punto guarda quién sacaba antes y después y sus efectos automáticos; deshacer el punto los revierte.
  - Un punto solo se puede anular si después de él solo hubo estadísticas.
  - "Rotar" y "Corregir saque" (menu ⋯) quedan para corregir a mano.
- **Líbero.**
  - Usa una operación propia, distinta de la sustitución normal.
  - Automático: cuando una rotación lo lleva a la red (P4) sale y vuelve el jugador al que reemplazaba; cuando perdemos el saque entra por el central (CE) que esté en zaga, empezando por P1.
  - No ve SB, Blocks, BE ni Kills (no puede bloquear ni rematar por encima de la red). Quien juega de líbero en el partido cuenta como líbero aunque su ficha tenga otro rol.
  - Solo entra en zaga y nunca aparece un séptimo círculo.
  - Al salir vuelve el jugador al que reemplazó.
  - Si una rotación lo deja en fila delantera, la app avisa sin bloquear ni perder datos.
- **Jugadores con partidos no se borran**, solo se desactivan.
- **Plantilla del partido:** al crearlo se toma una instantánea de todos los jugadores activos (titulares, líbero y suplentes).

## Pendiente / por confirmar

- **Catálogo de estadísticas.** La tabla de la sección 5 de la especificación no venía en el PDF, así que se usaron estos códigos, todos editables desde *Configuración*:
  - Recepción: R+, R#, RE
  - Defensa: SD, BT
  - Bloqueo: SB, Blocks, BE
  - Ataque: Kills, Errors, Attempts
  - Servicio: Aces, SE
  - Otras: Touches, BM
- **Significado de BM.** No está definido en la especificación. Está configurado como métrica de equipo (aparece en el resumen de equipo con quién la registró). Edita su nombre y descripción en Configuración.
- **Reglas oficiales.** No se validan límites de sustituciones por set, como pide el alcance del MVP.
