#!/usr/bin/env node
// bin/dev-orchestra.mjs — e' o que o `npx dev-orchestra` roda.
// Sobe um servidor local (127.0.0.1, porta livre), serve a tela setup/config.html e responde
// /estado, /testar e /salvar usando o dist/setup.js. Depois de salvar sem erros encerra sozinho.
// A chave de API nunca vai pro stdout/stderr nem volta nas respostas HTTP.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detectar, lerAtual, PROVEDORES, testarChave, salvar, localDoApp, copiarApp, ferramentasConfiguradas, comandoNpm, chaveAtual } from "../dist/setup.js";

// pacote = a pasta acima de bin/ (a raiz do pacote publicado ou do clone).
const BIN = path.dirname(fileURLToPath(import.meta.url));
const PACOTE = path.resolve(BIN, "..");
const HOME = os.homedir();
const TELA = path.join(PACOTE, "setup", "config.html");
const SKILLS = path.join(PACOTE, "setup", "skills");

const msgErro = (e) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function responderJson(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(corpo),
    "Cache-Control": "no-store",
  });
  res.end(corpo);
}

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let dados = "";
    req.setEncoding("utf8");
    req.on("data", (pedaco) => {
      dados += pedaco;
      if (dados.length > 1_000_000) req.destroy(); // corpo absurdo: corta
    });
    req.on("end", () => ok(dados));
    req.on("error", falha);
  });
}

// Perfis do PowerShell: onde o instalador antigo podia ter deixado uma linha pra remover.
function perfisPowerShell() {
  return [
    path.join(HOME, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(HOME, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(HOME, "OneDrive", "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(HOME, "OneDrive", "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
  ];
}

function abrirNavegador(url) {
  try {
    let cmd;
    let args;
    if (process.platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else if (process.platform === "darwin") {
      cmd = "open";
      args = [url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* abrir o navegador e' best-effort: a url ja esta no stdout */
  }
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

async function tratarTestar(corpo, res) {
  const provedor = typeof corpo?.provedor === "string" ? corpo.provedor : "";
  const modelo = typeof corpo?.modelo === "string" ? corpo.modelo.trim() : "";
  if (!Object.prototype.hasOwnProperty.call(PROVEDORES, provedor)
    || !PROVEDORES[provedor]?.modelos.includes(modelo)) {
    responderJson(res, 400, { ok: false, erro: "Escolha um provedor e um modelo validos antes de testar." });
    return;
  }
  let chave = typeof corpo?.chave === "string" ? corpo.chave.trim() : "";
  if (!chave) chave = chaveAtual(HOME, provedor); // chave vazia = testa a atual (se houver)
  if (!chave) {
    responderJson(res, 400, { ok: false, erro: "Informe a chave do provedor." });
    return;
  }
  const resultado = await testarChave(provedor, modelo, chave);
  responderJson(res, 200, resultado);
}

// Copia o app pra ~/.dev-orchestra/app e instala as deps de producao la'. Devolve o dist/index.js
// que o MCP de cada ferramenta vai rodar.
function instalarApp() {
  const app = localDoApp(HOME);
  const pastaApp = path.dirname(path.dirname(app));
  try {
    copiarApp(PACOTE, pastaApp);
  } catch (e) {
    throw new Error(`Falha ao copiar o app pra ${pastaApp}: ${msgErro(e)}`);
  }
  const args = ["install", "--omit=dev", "--prefer-offline", "--no-audit", "--no-fund"];
  const n = comandoNpm(process.execPath, existsSync);
  const cmdFallback = "npm " + args.join(" ");
  const inst = n
    ? spawnSync(n.comando, [...n.args, ...args], { cwd: pastaApp, encoding: "utf8", windowsHide: true })
    : spawnSync(cmdFallback, { cwd: pastaApp, shell: true, encoding: "utf8" });
  if (inst.status !== 0) {
    const saida = `${inst.stderr ?? ""}${inst.stdout ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 300);
    const detalhe = inst.error ? msgErro(inst.error) : saida || `npm install saiu com codigo ${inst.status}`;
    throw new Error(`Falha ao instalar as dependencias: ${detalhe}`);
  }
  return app;
}

// `--instalar` (npm run instalar): atualiza a copia e reaponta as ferramentas ja' configuradas,
// mantendo provedor, modelo e chave. Sem tela.
function instalarSemTela() {
  const atual = lerAtual(HOME);
  const ferramentas = ferramentasConfiguradas(HOME);
  if (!atual.provedor || !atual.modelo || ferramentas.length === 0) {
    console.error("dev-orchestra: nada configurado ainda. Rode `npx github:daKires/dev-orchestra` (ou `npm run instalar`) uma vez pela tela.");
    process.exit(1);
  }
  try {
    const app = instalarApp();
    const r = salvar(HOME, { provedor: atual.provedor, modelo: atual.modelo, chave: "", ferramentas, app, skillsDir: SKILLS, perfis: perfisPowerShell() });
    for (const [f, erro] of Object.entries(r.erros)) console.error(`dev-orchestra: ${f}: ${erro}`);
    console.log(`dev-orchestra: app instalado em ${path.dirname(path.dirname(app))}; atualizado em ${r.ok.join(", ") || "nenhuma ferramenta"}. Reinicie as ferramentas pra pegar a versao nova.`);
    process.exit(Object.keys(r.erros).length ? 1 : 0);
  } catch (e) {
    console.error(`dev-orchestra: ${msgErro(e)}`);
    process.exit(1);
  }
}

if (process.argv.includes("--instalar")) instalarSemTela();

async function tratarSalvar(corpo, res) {
  const provedor = typeof corpo?.provedor === "string" ? corpo.provedor : "";
  const modelo = typeof corpo?.modelo === "string" ? corpo.modelo.trim() : "";
  const chave = typeof corpo?.chave === "string" ? corpo.chave.trim() : "";
  const ferramentas = Array.isArray(corpo?.ferramentas)
    ? corpo.ferramentas.filter((f) => typeof f === "string")
    : [];

  let app;
  try {
    app = instalarApp();
  } catch (e) {
    responderJson(res, 500, { erro: msgErro(e) });
    return;
  }

  let resultado;
  try {
    resultado = salvar(HOME, {
      provedor,
      modelo,
      chave,
      ferramentas,
      app,
      skillsDir: SKILLS,
      perfis: perfisPowerShell(),
    });
  } catch (e) {
    responderJson(res, 400, { erro: msgErro(e) });
    return;
  }

  // Resposta sem a chave: so' o que foi gravado por ferramenta.
  responderJson(res, 200, { ok: resultado.ok, erros: resultado.erros });

  if (Object.keys(resultado.erros).length === 0 && resultado.ok.length > 0) {
    console.log('Pronto. Diga "use o orchestra" na sua ferramenta (reinicie ela antes).');
    setTimeout(() => process.exit(0), 500).unref?.();
  }
}

// Barra DNS rebinding: dominio alheio que resolve pra 127.0.0.1 chega com o Host dele.
function hostLocal(cabecalho, porta) {
  const h = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  if (typeof h !== "string") return false;
  const alvo = h.toLowerCase();
  return alvo === `127.0.0.1:${porta}` || alvo === `localhost:${porta}`;
}

const servidor = http.createServer((req, res) => {
  Promise.resolve()
    .then(async () => {
      const endereco = servidor.address();
      const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
      if (!hostLocal(req.headers.host, porta)) {
        respostaTexto(res, 403, "Host nao permitido");
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rota = url.pathname;

      if (req.method === "GET" && (rota === "/" || rota === "/index.html")) {
        let html;
        try {
          html = readFileSync(TELA);
        } catch {
          respostaTexto(res, 500, "Tela de configuracao nao encontrada (setup/config.html).");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": html.length,
          "Cache-Control": "no-store",
        });
        res.end(html);
        return;
      }

      if (req.method === "GET" && rota === "/estado") {
        responderJson(res, 200, {
          ferramentas: detectar(HOME),
          atual: lerAtual(HOME),
          provedores: PROVEDORES,
        });
        return;
      }

      if (req.method === "POST") {
        // Todo POST exige o cabecalho: evita que uma pagina qualquer da maquina mexa na config.
        if (!req.headers["x-dev-orchestra"]) {
          responderJson(res, 403, { erro: "Cabecalho X-Dev-Orchestra ausente." });
          return;
        }
        const cru = await lerCorpo(req);
        let corpo = {};
        if (cru.trim()) {
          try {
            corpo = JSON.parse(cru);
          } catch {
            responderJson(res, 400, { erro: "Corpo invalido: esperava JSON." });
            return;
          }
        }
        if (rota === "/testar") {
          await tratarTestar(corpo, res);
          return;
        }
        if (rota === "/salvar") {
          await tratarSalvar(corpo, res);
          return;
        }
        responderJson(res, 404, { erro: "Rota nao encontrada." });
        return;
      }

      responderJson(res, 404, { erro: "Rota nao encontrada." });
    })
    .catch((e) => {
      try {
        responderJson(res, 500, { erro: msgErro(e) });
      } catch {
        /* resposta ja enviada */
      }
    });
});

function respostaTexto(res, status, texto) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(texto);
}

servidor.on("error", (e) => {
  console.error(`dev-orchestra: falha ao subir a tela local: ${msgErro(e)}`);
  process.exit(1);
});

servidor.listen(0, "127.0.0.1", () => {
  const endereco = servidor.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
  const url = `http://127.0.0.1:${porta}`;
  console.log(`dev-orchestra: ${url}`);
  if (process.env.DEV_ORCHESTRA_NAO_ABRIR !== "1") abrirNavegador(url);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
