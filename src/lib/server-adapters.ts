import "server-only";
// The route-facing boundary enforces server-only imports at build time.
// Worker and CLI code use the Node-only adapter implementation directly.
export { validatePurchase } from "./adapters";
