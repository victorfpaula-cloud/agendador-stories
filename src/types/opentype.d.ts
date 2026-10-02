declare module "opentype.js" {
  // Tipagem mínima: só o que o motor de tipografia usa.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function parse(buffer: ArrayBuffer): any;
}
