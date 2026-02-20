/*
 * Categorias y metadata de las reglas.
 * Proporciona informacion descriptiva para el panel de resumen.
 */

import { CategoriaRegla } from '../types';

export interface MetadataCategoria {
  id: CategoriaRegla;
  nombre: string;
  descripcion: string;
  seccionProtocolo: string;
}

export const categoriasRegla: MetadataCategoria[] = [
  {
    id: CategoriaRegla.LimitesArchivo,
    nombre: 'Limites de Archivo',
    descripcion: 'Componentes max 300 lineas, hooks max 120, utils max 150',
    seccionProtocolo: 'Seccion 3',
  },
  {
    id: CategoriaRegla.PatronesProhibidos,
    nombre: 'Patrones Prohibidos',
    descripcion: 'eval(), @funciones, catches vacios, secrets hardcodeados',
    seccionProtocolo: 'Seccion 7',
  },
  {
    id: CategoriaRegla.EstructuraNomenclatura,
    nombre: 'Estructura y Nomenclatura',
    descripcion: 'useState excesivo, barras decorativas, imports muertos',
    seccionProtocolo: 'Secciones 2, 4, 5',
  },
  {
    id: CategoriaRegla.WordPressPhp,
    nombre: 'WordPress/PHP',
    descripcion: 'try-catch en controllers, sanitizacion de inputs',
    seccionProtocolo: 'Seccion 7',
  },
  {
    id: CategoriaRegla.SeguridadSql,
    nombre: 'Seguridad SQL',
    descripcion: '$wpdb->prepare() obligatorio, no SQL interpolado',
    seccionProtocolo: 'Seccion 7',
  },
  {
    id: CategoriaRegla.ReactPatrones,
    nombre: 'React Patrones',
    descripcion: 'Inmutabilidad, useEffect cleanup, update optimista rollback',
    seccionProtocolo: 'Seccion 7',
  },
  {
    id: CategoriaRegla.CssEstilos,
    nombre: 'CSS Estilos',
    descripcion: 'No CSS inline, variables obligatorias, nomenclatura espanol',
    seccionProtocolo: 'Seccion 5',
  },
  {
    id: CategoriaRegla.SemanticaIA,
    nombre: 'Semantica IA',
    descripcion: 'Separacion logica-vista, SRP, I/O sin proteccion',
    seccionProtocolo: 'Nivel 2',
  },
];
