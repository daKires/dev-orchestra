// Caminhos e ids compartilhados entre o hub de teste (hub.mjs) e as specs.
import os from "node:os";
import path from "node:path";

export const PORTA = 4199;
export const BASE = path.join(os.tmpdir(), "dev-orchestra-e2e");
export const RUNS = path.join(BASE, "runs");
export const REPO = path.join(BASE, "repo");
export const RUN_A = "e2e-a"; // ativa: S1 ok, S2 ok, S3 rodando, S4 fila
export const RUN_B = "e2e-b"; // COMPLETE: merge
export const RUN_C = "e2e-c"; // COMPLETE: descartar
