/* [22A-2] Shim para lanzar sentinel-lsp desde el checkout de desarrollo.
 * La extension WASM de Zed no puede navegar con .. fuera de su directorio
 * (sandbox WASI), pero puede leer este archivo. Node.js resuelve el require
 * sin restricciones WASI. */
const path = require("path");
const lspPath = path.resolve(__dirname, "../../out/lsp/server.js");
require(lspPath);
