// Source files bundled as text (see scripts/build-node.mjs).
declare module "*.cs" {
  const text: string;
  export default text;
}
declare module "*.ps1" {
  const text: string;
  export default text;
}
