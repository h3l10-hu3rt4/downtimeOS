/**
 * Deduplica cargas equivalentes y permite invalidar una respuesta en curso
 * cuando una mutación exige consultar de nuevo la fuente de verdad.
 */
export function crearControlCarga() {
  let revision = 0;
  let cargaEnCurso = null;

  return {
    ejecutar(trabajo, { forzar = false } = {}) {
      if (cargaEnCurso && !forzar) return cargaEnCurso;

      const actual = { revision: ++revision, promesa: null };
      actual.esVigente = () => actual.revision === revision;
      actual.promesa = Promise.resolve().then(() => trabajo(actual));
      cargaEnCurso = actual;

      const liberar = () => {
        if (cargaEnCurso === actual) cargaEnCurso = null;
      };
      actual.promesa.then(liberar, liberar);
      return actual;
    },
  };
}
