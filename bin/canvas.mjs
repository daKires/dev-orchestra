#!/usr/bin/env node
// CLI `canvas` (F3 S3): ponte de linha de comando para o hub Dev Orchestra.
// Node puro, sem dependencias. Fala com o hub via POST /cli/<rota>.
import http from "node:http";

const USO = `uso: canvas --eu <id>:<token> <comando> [args...]
comandos:
  list
  ask <alvo> <texto>
  tell <alvo> <texto>
  reply <q> <texto>
  flow add <chave> <forma> <texto> [--cor <cor>]
  flow link <a> <b> [rótulo]
  file <caminho> <status>
  note <título> <corpo>
  browser create <nome> <url>
  browser read [nav]
  browser click [nav] <alvo>
  browser type [nav] <alvo> <valor> [--enter]
  browser nav [nav] <ação>
  browser shot [nav]
  status <estado>

a identidade também pode vir da variável de ambiente DEV_ORCHESTRA_EU.`;

function erroUso() {
  console.error(USO);
  process.exit(1);
}

// Separa `--eu id:token` de qualquer posição dos args.
const bruto = process.argv.slice(2);
let euArg = null;
const args = [];
for (let i = 0; i < bruto.length; i++) {
  if (bruto[i] === "--eu") {
    euArg = bruto[i + 1] ?? "";
    i++;
  } else {
    args.push(bruto[i]);
  }
}

let eu = euArg && euArg.trim() ? euArg.trim() : String(process.env.DEV_ORCHESTRA_EU ?? "").trim();

// Sem comando: uso (mesmo sem identidade).
if (args.length === 0) erroUso();

// Sem identidade (arg nem env): erro citando "identidade".
if (!eu) {
  console.error("uso: identidade ausente — informe --eu <id>:<token> ou defina DEV_ORCHESTRA_EU.");
  process.exit(1);
}

const cmd = args[0];
let rota;
let corpo;

switch (cmd) {
  case "list": {
    if (args.length !== 1) erroUso();
    rota = "list";
    corpo = {};
    break;
  }
  case "ask": {
    if (args.length !== 3) erroUso();
    rota = "ask";
    corpo = { alvo: args[1], texto: args[2] };
    break;
  }
  case "tell": {
    if (args.length !== 3) erroUso();
    rota = "tell";
    corpo = { alvo: args[1], texto: args[2] };
    break;
  }
  case "reply": {
    if (args.length !== 3) erroUso();
    rota = "reply";
    corpo = { q: args[1], texto: args[2] };
    break;
  }
  case "file": {
    if (args.length !== 3) erroUso();
    rota = "file";
    corpo = { caminho: args[1], status: args[2] };
    break;
  }
  case "note": {
    if (args.length !== 3) erroUso();
    rota = "note";
    corpo = { titulo: args[1], corpo: args[2] };
    break;
  }
  case "flow": {
    const sub = args[1];
    if (sub === "add") {
      const rest = args.slice(2);
      if (rest.length < 3) erroUso();
      corpo = { chave: rest[0], forma: rest[1], texto: rest[2] };
      if (rest.length > 3) {
        if (rest[3] === "--cor" && rest.length === 5) corpo.cor = rest[4];
        else erroUso();
      }
      rota = "flow-add";
    } else if (sub === "link") {
      const rest = args.slice(2);
      if (rest.length < 2 || rest.length > 3) erroUso();
      corpo = { a: rest[0], b: rest[1] };
      if (rest.length === 3) corpo.rotulo = rest[2];
      rota = "flow-link";
    } else {
      erroUso();
    }
    break;
  }
  case "browser": {
    const sub = args[1];
    if (sub === "create") {
      const rest = args.slice(2);
      if (rest.length !== 2) erroUso();
      corpo = { nome: rest[0], url: rest[1] };
      rota = "browser-create";
    } else if (sub === "read") {
      const rest = args.slice(2);
      if (rest.length > 1) erroUso();
      corpo = {};
      if (rest.length === 1) corpo.nav = rest[0];
      rota = "browser-read";
    } else if (sub === "click") {
      const rest = args.slice(2);
      if (rest.length === 1) corpo = { alvo: rest[0] };
      else if (rest.length === 2) corpo = { nav: rest[0], alvo: rest[1] };
      else erroUso();
      rota = "browser-click";
    } else if (sub === "type") {
      const rest = args.slice(2);
      let enter = false;
      const pos = [];
      for (const a of rest) {
        if (a === "--enter") enter = true;
        else pos.push(a);
      }
      if (pos.length === 2) corpo = { alvo: pos[0], valor: pos[1] };
      else if (pos.length === 3) corpo = { nav: pos[0], alvo: pos[1], valor: pos[2] };
      else erroUso();
      if (enter) corpo.enter = true;
      rota = "browser-type";
    } else if (sub === "nav") {
      const rest = args.slice(2);
      if (rest.length === 1) corpo = { acao: rest[0] };
      else if (rest.length === 2) corpo = { nav: rest[0], acao: rest[1] };
      else erroUso();
      rota = "browser-nav";
    } else if (sub === "shot") {
      const rest = args.slice(2);
      if (rest.length > 1) erroUso();
      corpo = {};
      if (rest.length === 1) corpo.nav = rest[0];
      rota = "browser-shot";
    } else {
      erroUso();
    }
    break;
  }
  case "status": {
    if (args.length !== 2) erroUso();
    rota = "status";
    corpo = { estado: args[1] };
    break;
  }
  default:
    erroUso();
}

const porta = Number(process.env.DEV_ORCHESTRA_UI_PORT || 4123);
const dados = JSON.stringify(corpo);

const req = http.request(
  {
    host: "127.0.0.1",
    port: porta,
    path: `/cli/${rota}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-Orchestra": "1",
      "X-Eu": eu,
      "Content-Length": Buffer.byteLength(dados),
    },
  },
  (res) => {
    let texto = "";
    res.setEncoding("utf8");
    res.on("data", (d) => { texto += d; });
    res.on("end", () => {
      const code = res.statusCode ?? 0;
      if (code >= 200 && code < 300) {
        process.stdout.write(texto.endsWith("\n") ? texto : texto + "\n");
        process.exit(0);
      } else {
        process.stderr.write(texto.endsWith("\n") ? texto : texto + "\n");
        process.exit(1);
      }
    });
  }
);

req.on("error", () => {
  console.error(`hub Dev Orchestra inacessível em 127.0.0.1:${porta}`);
  process.exit(2);
});

req.end(dados);
