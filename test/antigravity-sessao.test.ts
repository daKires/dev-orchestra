// Spec da S1 (CA-1..CA-6): setup.ts (config vazia e 3 pastas de skills no Antigravity) e sessao.ts/hub.ts (sessao do Antigravity).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fonte, modulo } from "./partir-ui-util.js";

const TMP = mkdtempSync(path.join(os.tmpdir(), "agy-sessao-"));
const DB = path.join(TMP, "conversation_summaries.db");
const ANN = path.join(TMP, "annotations");
mkdirSync(ANN, { recursive: true });
process.env.DEV_ORCHESTRA_ANTIGRAVITY_DB = DB;
process.env.DEV_ORCHESTRA_ANTIGRAVITY_ANNOTATIONS = ANN;

const UUID_ENV = "921313a2-7119-4346-81e1-e89dd2c695fa";
const UUID_DB_VELHA = "11111111-1111-4111-8111-111111111111";
const UUID_DB_NOVA = "22222222-2222-4222-8222-222222222222";
const UUID_FILHA = "33333333-3333-4333-8333-333333333333";
const UUID_OUTRA = "44444444-4444-4444-8444-444444444444";
const UUID_PBTXT = "55555555-5555-4555-8555-555555555555";

const WS = path.join(TMP, "Workspace Pai");
const SUBPASTA = path.join(WS, "mcp-hermes-bridge");
mkdirSync(SUBPASTA, { recursive: true });

function criarBancoAntigravity() {
  const db = new DatabaseSync(DB);
  db.exec(
    "CREATE TABLE IF NOT EXISTS conversation_summaries (" +
      "conversation_id text PRIMARY KEY, " +
      "title text NOT NULL DEFAULT '', " +
      "workspace_uris text NOT NULL, " +
      "parent_conversation_id text NOT NULL DEFAULT '', " +
      "last_modified_time datetime NOT NULL" +
    ")",
  );
  db.exec("DELETE FROM conversation_summaries");
  const ins = db.prepare(
    "INSERT INTO conversation_summaries (conversation_id, title, workspace_uris, parent_conversation_id, last_modified_time) VALUES (?, ?, ?, ?, ?)",
  );
  const uriWs = pathToFileURL(WS).href;
  ins.run(UUID_DB_VELHA, "Conversa Antiga", JSON.stringify([uriWs]), "", "2026-10-20 19:00:00.0000000+00:00");
  ins.run(UUID_DB_NOVA, "Configuração Do Dev-Orchestra", JSON.stringify([uriWs]), "", "2026-10-20 21:00:00.0000000+00:00");
  ins.run(UUID_FILHA, "Subagente Filha", JSON.stringify([uriWs]), UUID_DB_NOVA, "2026-10-20 22:00:00.0000000+00:00");
  ins.run(UUID_OUTRA, "Outro Projeto", JSON.stringify(["file:///c:/outro/lugar"]), "", "2026-10-20 23:00:00.0000000+00:00");
  db.close();
}

test("setup.ts: arquivo mcp_config.json de 0 bytes ou espacos e' tratado como {} e skills vao para as 3 pastas do Antigravity (CA-1/CA-2)", async () => {
  const S = await modulo("dist/setup.js") as Record<string, any>;
  assert.equal(typeof S.salvar, "function");
  const home = mkdtempSync(path.join(TMP, "home-"));
  const cfgDir = path.join(home, ".gemini", "config");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(path.join(cfgDir, "mcp_config.json"), ""); // 0 bytes como o Antigravity cria
  const agyDir = path.join(home, ".gemini", "antigravity");
  mkdirSync(agyDir, { recursive: true });
  writeFileSync(path.join(agyDir, "mcp_config.json"), "   \n  "); // so espacos

  const skillsDir = mkdtempSync(path.join(TMP, "skills-"));
  for (const n of ["orchestra", "plan-sdd"]) {
    mkdirSync(path.join(skillsDir, n), { recursive: true });
    writeFileSync(path.join(skillsDir, n, "SKILL.md"), `---\nname: ${n}\n---\nconteudo ${n}\n`);
  }

  const r = S.salvar(home, {
    provedor: "go",
    modelo: "deepseek-v4.1-flash",
    chave: "sk-go-123456789abcd",
    ferramentas: ["antigravity"],
    app: "C:\\app\\dist\\index.js",
    skillsDir,
    perfis: [],
  });
  assert.deepEqual(r.erros, {}, "mcp_config.json vazio nao deve falhar");
  assert.deepEqual(r.ok, ["antigravity"]);

  for (const p of [
    path.join(home, ".gemini", "config", "mcp_config.json"),
    path.join(home, ".gemini", "antigravity", "mcp_config.json"),
  ]) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(j.mcpServers["dev-orchestra"].args[0], "C:\\app\\dist\\index.js");
  }

  for (const dest of [
    path.join(home, ".gemini", "skills"),
    path.join(home, ".gemini", "antigravity", "skills"),
    path.join(home, ".gemini", "config", "skills"),
  ]) {
    assert.match(readFileSync(path.join(dest, "orchestra", "SKILL.md"), "utf8"), /conteudo orchestra/, dest);
    assert.match(readFileSync(path.join(dest, "plan-sdd", "SKILL.md"), "utf8"), /conteudo plan-sdd/, dest);
  }
});

test("sessaoAtual: descobre Antigravity por ANTIGRAVITY_CONVERSATION_ID e pelo banco SQLite (inclusive subpasta do workspace) (CA-3/CA-4)", async () => {
  const m = await modulo("dist/sessao.js") as Record<string, any>;
  criarBancoAntigravity();

  // CA-3: por env direta
  assert.deepEqual(
    m.sessaoAtual({ ANTIGRAVITY_CONVERSATION_ID: UUID_ENV }, SUBPASTA),
    { planejador: "antigravity", id: UUID_ENV },
  );

  // CA-4: sem ANTIGRAVITY_CONVERSATION_ID, mas com ANTIGRAVITY_AGENT=1 -> busca conversa raiz mais recente do workspace (mesmo cwd sendo subpasta)
  assert.deepEqual(
    m.sessaoAtual({ ANTIGRAVITY_AGENT: "1", DEV_ORCHESTRA_ANTIGRAVITY_DB: DB }, SUBPASTA),
    { planejador: "antigravity", id: UUID_DB_NOVA },
  );
  assert.deepEqual(
    m.sessaoAtual({ ANTIGRAVITY_AGENT: "1", DEV_ORCHESTRA_ANTIGRAVITY_DB: DB }, WS),
    { planejador: "antigravity", id: UUID_DB_NOVA },
  );
  assert.equal(
    m.sessaoAtual({ ANTIGRAVITY_AGENT: "1", DEV_ORCHESTRA_ANTIGRAVITY_DB: DB }, path.join(TMP, "pasta-sem-conversa")),
    undefined,
  );
});

test("tituloSessao: le titulo do Antigravity no SQLite e faz fallback para annotations/<id>.pbtxt (CA-5)", async () => {
  const m = await modulo("dist/sessao.js") as Record<string, any>;
  criarBancoAntigravity();

  assert.equal(
    m.tituloSessao({ planejador: "antigravity", id: UUID_DB_NOVA }),
    "Configuração Do Dev-Orchestra",
  );

  // Fallback para annotations/<id>.pbtxt quando o id nao esta no banco
  writeFileSync(
    path.join(ANN, UUID_PBTXT + ".pbtxt"),
    'title:"Titulo Via Annotation" last_user_view_time:{seconds:1792530278 nanos:280000000}\n',
  );
  assert.equal(
    m.tituloSessao({ planejador: "antigravity", id: UUID_PBTXT }),
    "Titulo Via Annotation",
  );
  assert.equal(
    m.tituloSessao({ planejador: "antigravity", id: "00000000-0000-4000-8000-000000000000" }),
    "",
  );
});

test("comoAbrirSessao: abre deep link antigravity://conversation/<id>, devolve id em copia e recusa id invalido (CA-6)", async () => {
  const m = await modulo("dist/sessao.js") as Record<string, any>;
  const win = m.comoAbrirSessao({ planejador: "antigravity", id: UUID_ENV }, SUBPASTA, "win32");
  assert.ok(win, "sessao antigravity valida abre");
  assert.match(JSON.stringify(win.args), new RegExp("antigravity://conversation/" + UUID_ENV));
  assert.equal(win.copia, UUID_ENV);

  const mac = m.comoAbrirSessao({ planejador: "antigravity", id: UUID_ENV }, SUBPASTA, "darwin");
  assert.equal(mac?.comando, "open");
  assert.match(JSON.stringify(mac?.args), new RegExp("antigravity://conversation/" + UUID_ENV));

  assert.equal(m.comoAbrirSessao({ planejador: "antigravity", id: "nao-e-uuid" }, SUBPASTA, "win32"), null);
  assert.equal(m.comoAbrirSessao({ planejador: "antigravity", id: UUID_ENV + "&calc" }, SUBPASTA, "win32"), null);

  const hubSrc = fonte("src/hub.ts");
  assert.match(hubSrc, /"antigravity"/, "Evento run em src/hub.ts aceita planejador antigravity");
});
