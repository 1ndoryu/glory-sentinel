/* Perfiles de exención con nombre. Datos separados del mecanismo (exencionesProyecto.ts) para que el núcleo no
 * dependa de un framework concreto: añadir un perfil es añadir una entrada aquí, sin tocar la lógica. */
export interface ExencionesResueltas {
  rutas: string[];
  componentes: string[];
}

/* Cada perfil agrupa lo que un framework define por su cuenta. "glory" es el del framework Glory. */
export const PERFILES_EXENCION: Readonly<Record<string, ExencionesResueltas>> = {
  glory: {
    rutas: ['/glory-rs/', '/public/assets/'],
    componentes: ['PageRenderer', 'ModalAcciones', 'GloryLink', 'Range'],
  },
};
