/* Reglas Rust (reglas por patrón de línea: handler con acceso a BD y broadcast::Mutex.) Extraído de rustAnalyzer.ts. */
import { Violacion } from '../../../types';
import { obtenerSeveridadRegla } from '../../../config/ruleRegistry';
import { tieneSentinelDisableFile } from '../../../utils/analisisHelpers';

/* Detecta sqlx::query directo en archivos de handlers/ (viola DIP) */
/* El DIP aplica a codigo de produccion: el SQL de fixtures dentro de
 * #[cfg(test)] (p. ej. mod pruebas al final de un handler) no es un handler
 * accediendo a BD. Mismo criterio que unwrap/panic (rangoTests). */
export function detectarHandlerAccedeBd(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, 'handler-accede-bd-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];
  const patron = /sqlx::query(?:_as|_scalar)?[!]?\s*[(<:]/g;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    if (rangoTests.has(i)) {
      continue;
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line handler-accede-bd-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable handler-accede-bd-rs')) {
      continue;
    }

    let match: RegExpExecArray | null;
    patron.lastIndex = 0;
    while ((match = patron.exec(linea)) !== null) {
      violaciones.push({
        reglaId: 'handler-accede-bd-rs',
        mensaje: 'Query SQL directa en handler. Mover al repositorio correspondiente (DIP).',
        severidad: obtenerSeveridadRegla('handler-accede-bd-rs'),
        linea: i,
        columna: match.index,
        columnaFin: match.index + match[0].length,
        fuente: 'estatico',
      });
    }
  }

  return violaciones;
}

/* [096A] Detecta uso de tokio::sync::broadcast que usa std::sync::Mutex interno.
 *
 * broadcast::Sender::send() adquiere un Mutex en cada envio. Con multiples
 * sends concurrentes al mismo canal, los tokio workers se bloquean en futex_wait
 * hasta congelar el runtime completo (incidente 096A: 15+ caidas, 13 fixes).
 *
 * Patron prohibido:
 *   use tokio::sync::broadcast;         // import
 *   let (tx, rx) = broadcast::channel(N); // creacion
 *   tx.send(msg);                        // send con Mutex interno
 *
 * Solucion: mpsc::unbounded_channel por suscriptor (lock-free):
 *   use tokio::sync::mpsc;
 *   let (tx, rx) = mpsc::unbounded_channel();  // lock-free
 *   tx.send(msg).ok();                          // nunca bloquea
 */
export function detectarBroadcastMutex(
  lineas: string[],
  rangoTests: Set<number>,
  texto: string,
): Violacion[] {
  if (tieneSentinelDisableFile(texto, 'broadcast-mutex-riesgo-rs')) {
    return [];
  }

  const violaciones: Violacion[] = [];

  /* Patrones a detectar:
   * 1. `use tokio::sync::broadcast` — import del modulo
   * 2. `broadcast::channel(` — creacion de canal
   * 3. `broadcast::Sender` o `broadcast::Receiver` — anotaciones de tipo */
  const patrones: { regex: RegExp; descripcion: string }[] = [
    { regex: /\buse\s+tokio::sync::broadcast\b/, descripcion: 'import de broadcast' },
    { regex: /\bbroadcast::channel\s*[<(]/, descripcion: 'creacion de canal broadcast' },
    { regex: /\bbroadcast::Sender\b/, descripcion: 'tipo broadcast::Sender' },
    { regex: /\bbroadcast::Receiver\b/, descripcion: 'tipo broadcast::Receiver' },
  ];

  for (let i = 0; i < lineas.length; i++) {
    if (rangoTests.has(i)) { continue; }

    const linea = lineas[i];
    const trimmed = linea.trim();

    /* Saltar comentarios */
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    /* Saltar lineas con sentinel-disable */
    if (i > 0 && lineas[i - 1].includes('sentinel-disable-next-line broadcast-mutex-riesgo-rs')) {
      continue;
    }
    if (linea.includes('sentinel-disable broadcast-mutex-riesgo-rs')) {
      continue;
    }

    for (const patron of patrones) {
      const match = patron.regex.exec(linea);
      if (match) {
        violaciones.push({
          reglaId: 'broadcast-mutex-riesgo-rs',
          mensaje: `tokio::sync::broadcast detectado (${patron.descripcion}). broadcast::Sender::send() usa std::sync::Mutex interno — bloquea tokio workers bajo contencion. Usar mpsc::unbounded_channel por suscriptor (lock-free). Incidente 096A.`,
          severidad: obtenerSeveridadRegla('broadcast-mutex-riesgo-rs'),
          linea: i,
          columna: match.index,
          columnaFin: match.index + match[0].length,
          fuente: 'estatico',
        });
        break; /* Solo una violacion por linea */
      }
    }
  }

  return violaciones;
}
