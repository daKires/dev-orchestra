// Navegador controlado por agentes (F4 S1): logica PURA (CA-7a, 7b, 7c).
// Roda com `node --experimental-strip-types`: apenas imports de `node:` e de ./colaboracao.ts
// (para slugNome); sem enum/namespace.
// Copia do slugNome de colaboracao.ts: modulo puro nao importa modulos locais em runtime (roda com
// --experimental-strip-types nos testes e compilado pelo tsc no hub).
function slugNome(nome) {
    return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
// ---------------------------------------------------------------------------
// URL (CA-7a)
// ---------------------------------------------------------------------------
/** Aceita somente URLs http/https validas (qualquer caixa); recusa o resto. */
export function urlPermitida(url) {
    if (typeof url !== "string" || url.length === 0)
        return false;
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return false;
    }
    return u.protocol === "http:" || u.protocol === "https:";
}
// ---------------------------------------------------------------------------
// Formatacao da leitura (CA-7b)
// ---------------------------------------------------------------------------
/** Numero com 2 digitos (para data/hora). */
function p2(x) {
    return String(x).padStart(2, "0");
}
/**
 * Formata uma leitura para o agente: `# titulo`, url, linha vazia, texto (cortado em `max`
 * com '…' se maior), linha vazia e a lista de elementos (ou "Elementos: (nenhum)").
 */
export function formatarLeitura(l, max = 6000) {
    const texto = l.texto.length > max ? l.texto.slice(0, max) + "…" : l.texto;
    const linhas = [`# ${l.titulo}`, l.url, "", texto, ""];
    if (l.elementos.length === 0) {
        linhas.push("Elementos: (nenhum)");
    }
    else {
        linhas.push("Elementos:");
        for (const e of l.elementos)
            linhas.push(`[${e.n}] ${e.papel} "${e.rotulo}"`);
    }
    return linhas.join("\n");
}
// ---------------------------------------------------------------------------
// Resolucao de elemento (CA-7b)
// ---------------------------------------------------------------------------
/**
 * Resolve um alvo contra os elementos lidos: numero -> pelo `n` exato; texto -> rotulo que
 * contem o alvo (sem diferenciar maiusculas). Ambiguo devolve erro com 'ambíguo' e os numeros.
 */
export function resolverElemento(els, alvo) {
    const texto = String(alvo).trim();
    if (/^\d+$/.test(texto)) {
        const n = Number(texto);
        const achado = els.find((e) => e.n === n);
        if (!achado)
            return { erro: `elemento ${n} não existe; rode read de novo` };
        return { ok: achado };
    }
    const busca = texto.toLowerCase();
    const casam = els.filter((e) => e.rotulo.toLowerCase().includes(busca));
    if (casam.length === 0)
        return { erro: `nenhum elemento com o texto "${texto}"; rode read de novo` };
    if (casam.length === 1)
        return { ok: casam[0] };
    return { erro: `elemento "${texto}" é ambíguo: ${casam.map((e) => e.n).join(", ")}` };
}
// ---------------------------------------------------------------------------
// Nome do screenshot (CA-7b)
// ---------------------------------------------------------------------------
/** Nome de arquivo do screenshot: `<slugNome>-YYYYMMDD-HHMMSS.png` (hora local). */
export function nomeShot(nome, data) {
    const ts = `${data.getFullYear()}${p2(data.getMonth() + 1)}${p2(data.getDate())}` +
        `-${p2(data.getHours())}${p2(data.getMinutes())}${p2(data.getSeconds())}`;
    return `${slugNome(nome)}-${ts}.png`;
}
// ---------------------------------------------------------------------------
// Script de leitura (CA-7b)
// ---------------------------------------------------------------------------
/**
 * IIFE avaliada na pagina via `Runtime.evaluate`. Numera a partir de 1 os elementos
 * interativos VISIVEIS, marca cada um com `data-hermes-n` e devolve (JSON) o titulo, a url,
 * o texto da pagina e os elementos `{n, papel, rotulo}` (papel em PT, rotulo cortado em 80).
 */
export const SCRIPT_LEITURA = String.raw `(() => {
  const corta = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const papel = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const tipo = (el.getAttribute("type") || "").toLowerCase();
    if (role === "link" || tag === "a") return "link";
    if (role === "button" || tag === "button") return "botão";
    if (role === "checkbox" || tipo === "checkbox" || tipo === "radio") return "caixa";
    if (role === "tab") return "aba";
    if (role === "menuitem") return "item";
    if (tag === "select") return "seleção";
    return "campo";
  };
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return false;
    const st = window.getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
  };
  const rotulo = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return corta(aria, 80);
    if (el.innerText) return corta(el.innerText, 80);
    if (typeof el.value === "string" && el.value) return corta(el.value, 80);
    const ph = el.getAttribute("placeholder");
    if (ph) return corta(ph, 80);
    const ti = el.getAttribute("title");
    if (ti) return corta(ti, 80);
    return "";
  };
  const seletor = "a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [role=checkbox], [role=menuitem], [contenteditable]";
  const elementos = [];
  let n = 0;
  for (const el of document.querySelectorAll(seletor)) {
    if (!visivel(el)) continue;
    n += 1;
    el.setAttribute("data-hermes-n", String(n));
    elementos.push({ n, papel: papel(el), rotulo: rotulo(el) });
  }
  return JSON.stringify({
    titulo: document.title || "",
    url: location.href,
    texto: (document.body && document.body.innerText) || "",
    elementos,
  });
})()`;
