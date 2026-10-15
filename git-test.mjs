// Testa a parte git do Hermes: baseline -> coder edita -> commit, e prova que o BASELINE recupera o original.
import { baseline, commit } from "./dist/hermes.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pexec = promisify(execFile);

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-test-"));
const alvo = path.join(dir, "app.txt");
await fs.writeFile(alvo, "ORIGINAL\n");
const log = (l) => console.log("  " + l);

const { baselineRef, branch } = await baseline(dir, "minha feature", log);
await fs.writeFile(alvo, "MANGLED PELO CODER\n"); // simula um coder estragando o arquivo
await commit(dir, "minha feature", log);

const br = (await pexec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir })).stdout.trim();
const lg = (await pexec("git", ["log", "--oneline"], { cwd: dir })).stdout;
if (br !== "orchestra/minha-feature") throw new Error("branch inesperada: " + br);
if (!lg.includes("feat: minha feature") || !lg.includes("baseline:")) throw new Error("commits faltando:\n" + lg);

// rede de seguranca: recuperar o original a partir do baseline
await pexec("git", ["checkout", baselineRef, "--", "app.txt"], { cwd: dir });
const recuperado = (await fs.readFile(alvo, "utf8")).replace(/\r/g, ""); // git do Windows pode meter CRLF
if (recuperado !== "ORIGINAL\n") throw new Error("baseline NAO recuperou o original: " + JSON.stringify(recuperado));

console.log(`GIT PIPELINE OK -> branch=${br}; baseline recupera o original`);
await fs.rm(dir, { recursive: true, force: true });
process.exit(0);
