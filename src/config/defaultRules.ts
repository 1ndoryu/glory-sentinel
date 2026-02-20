/*
 * Reglas estaticas por defecto organizadas por categoria.
 * Cada regla tiene su regex, severidad y tipos de archivo a los que aplica.
 * Basado en las secciones 1.2, 1.3, 1.4 del protocolo.
 */

import { ReglaEstatica, CategoriaRegla } from '../types';

export const reglasEstaticas: ReglaEstatica[] = [

  /* --- Seccion 1.2: Patrones prohibidos --- */

  {
    id: 'php-supresor-at',
    nombre: 'Supresor @ en PHP',
    descripcion: 'PROHIBIDO usar @ como supresor de errores. Usar try-catch con logging.',
    patron: /@(unlink|file_get_contents|fopen|fclose|mkdir|rmdir|copy|rename|readfile|glob|file_put_contents|chmod|chown)\s*\(/,
    severidad: 'error',
    aplicaA: ['.php'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'Supresor @ detectado en "$1()". Usar try-catch con logging en su lugar.',
    porLinea: true,
    quickFixId: 'remove-at-suppressor',
  },

  /* wpdb-sin-prepare: gestionado por phpAnalyzer.ts con logica contextual.
   * Alli se excluyen correctamente START TRANSACTION, ROLLBACK, COMMIT y
   * se verifica prepare() en lineas cercanas. Una regla regex simple aqui
   * genera falsos positivos en sentencias de control de transaccion. */


  {
    id: 'eval-prohibido',
    nombre: 'eval() prohibido',
    descripcion: 'No usar eval() por riesgo de inyeccion de codigo.',
    patron: /\beval\s*\(/,
    severidad: 'error',
    aplicaA: ['.php', '.ts', '.tsx', '.js', '.jsx'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'eval() detectado. Eliminar y usar alternativa segura.',
    porLinea: true,
  },

  {
    id: 'innerhtml-variable',
    nombre: 'innerHTML con variable',
    descripcion: 'No asignar innerHTML con datos dinamicos sin sanitizar (riesgo XSS).',
    /* Clase negada en vez de lookahead: evita falso positivo por backtracking de \s* */
    patron: /\.innerHTML\s*=\s*[^'"\`\s]/,
    severidad: 'warning',
    aplicaA: ['.ts', '.tsx', '.js', '.jsx'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'innerHTML asignado con variable. Riesgo XSS. Sanitizar o usar metodo seguro.',
    porLinea: true,
  },

  {
    id: 'css-inline-jsx',
    nombre: 'CSS inline en JSX',
    descripcion: 'PROHIBIDO CSS inline. Usar archivo .css separado.',
    patron: /style\s*=\s*\{\{/,
    severidad: 'warning',
    aplicaA: ['.tsx', '.jsx'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'CSS inline detectado (style={{}}). Mover estilos a archivo .css separado.',
    porLinea: true,
    quickFixId: 'extract-inline-css',
  },

  {
    id: 'git-add-all',
    nombre: 'git add . / --all',
    descripcion: 'PROHIBIDO git add . o git add --all. Agregar archivos explicitamente.',
    /* (?=\s|$) en vez de \b: '\b' falla con '.' al final de cadena en JS */
    patron: /git\s+add\s+(\.|--all)(?=\s|$)/,
    severidad: 'warning',
    aplicaA: ['.sh', '.ps1', '.md', '.yml', '.yaml'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'git add . / --all detectado. Agregar archivos explicitamente con git add archivo1 archivo2.',
    porLinea: true,
  },

  {
    id: 'catch-vacio',
    nombre: 'Catch vacio',
    descripcion: 'PROHIBIDO dejar catches vacios. Siempre loguear o propagar el error.',
    patron: /catch\s*\([^)]*\)\s*\{\s*\}/,
    severidad: 'error',
    aplicaA: ['.php', '.ts', '.tsx', '.js', '.jsx'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'Catch vacio detectado. Agregar logging o propagacion del error.',
    porLinea: false,
    quickFixId: 'fill-empty-catch',
  },

  {
    id: 'hardcoded-secret',
    nombre: 'Secret/password hardcodeado',
    descripcion: 'PROHIBIDO hardcodear secrets en codigo fuente. Usar variables de entorno.',
    /* Lookbehind (?<!\.) excluye accesos de propiedad (obj.password = 'msg')
     * donde 'msg' es un mensaje de validacion, no un secret real. */
    patron: /(?<!\.)\b(password|secret|api_key|apikey|api_secret|token|private_key)\s*=\s*(['"])[^'"]{4,}\2/i,
    severidad: 'error',
    aplicaA: ['.php', '.ts', '.tsx', '.js', '.jsx', '.env.example'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'Posible secret hardcodeado ("$1"). Mover a variable de entorno.',
    porLinea: true,
  },

  /* --- Seccion 1.3: Estructura y nomenclatura --- */

  /* usestate-excesivo: gestionado por verificarUseStateExcesivo() en staticAnalyzer
   * que verifica el conteo total (>3) antes de reportar. Tenerlo aqui como porLinea
   * causaria que dispare en cada useState sin importar el conteo. */

  {
    id: 'barras-decorativas',
    nombre: 'Barras decorativas en comentarios',
    descripcion: 'Prohibido usar barras decorativas (====, ----) en comentarios.',
    patron: /[=]{4,}/,
    severidad: 'information',
    aplicaA: ['.php', '.ts', '.tsx', '.js', '.jsx'],
    categoria: CategoriaRegla.EstructuraNomenclatura,
    mensaje: 'Barras decorativas en comentario. Usar formato limpio /* ... */ sin decoracion.',
    porLinea: true,
  },

  /* --- Seccion 1.4: WordPress/PHP especificos --- */

  /* request-json-directo: gestionado por phpAnalyzer.ts con logica contextual.
   * La deteccion por regex simple genera falsos positivos cuando el resultado
   * se asigna a una variable y luego se accede por campos individuales ($datos['campo']).
   * El analyzer contextual distingue uso bare (peligroso) de acceso por subscript (seguro). */


  {
    id: 'at-generico-php',
    nombre: 'Supresor @ generico en PHP',
    descripcion: 'El operador @ oculta errores. Usar try-catch.',
    patron: /@[a-zA-Z_]\w*\s*\(/,
    severidad: 'warning',
    aplicaA: ['.php'],
    categoria: CategoriaRegla.PatronesProhibidos,
    mensaje: 'Operador @ detectado. Oculta errores silenciosamente. Usar try-catch.',
    porLinea: true,
  },
];
