// Visual da conversa e explorador (F3 S4/S5 implementam).
// PURO: so' tipos + funcoes (roda com `node --experimental-strip-types`); sem imports de runtime.

// Arestas em conversa (S4 - CA-6d)

/** Uma conversa pendente entre agentes, como o hub publica no SSE {conversas}. */
export type Conversa = { q: string; de: string; para: string; texto: string };

/** O minimo de uma aresta pro visual: id + as duas pontas. */
export type ArestaRef = { id: string; de: string; para: string };

/** Marcacao de uma aresta que esta' em conversa: sentido (pro balao animar certo) + texto do balao. */
export type EmConversa = { sentido: "direto" | "reverso"; balao: string };

/** Limite do balao: ate' 40 chars; acima disso, corta e sufixa '…'. */
const BALAO_MAX = 40;

/** Texto do balao a partir do texto da conversa (slice + reticencias quando maior que 40). */
function balao(texto: string): string {
  const t = typeof texto === "string" ? texto : "";
  return t.length > BALAO_MAX ? t.slice(0, BALAO_MAX) + "…" : t;
}

/**
 * Mapeia cada aresta que liga os agentes de uma conversa (CA-6d). A aresta vai entre `ag:<de>` e
 * `ag:<para>` em qualquer direcao: `direto` quando a aresta sai de `ag:<de>` e `reverso` quando sai
 * de `ag:<para>`. O balao e' o texto da conversa (ate' 40 chars). A PRIMEIRA conversa de cada aresta
 * vence (as seguintes nao sobrescrevem).
 */
export function arestasEmConversa(conversas: Conversa[], arestas: ArestaRef[]): Record<string, EmConversa> {
  const mapa: Record<string, EmConversa> = {};
  for (const c of conversas) {
    const origem = `ag:${c.de}`;
    const destino = `ag:${c.para}`;
    for (const a of arestas) {
      if (mapa[a.id]) continue; // a primeira conversa que casou a aresta vence
      const direto = a.de === origem && a.para === destino;
      const reverso = a.de === destino && a.para === origem;
      if (!direto && !reverso) continue;
      mapa[a.id] = { sentido: direto ? "direto" : "reverso", balao: balao(c.texto) };
    }
  }
  return mapa;
}

// Linhas de colaboracao na transcricao (S4 - CA-6d)

/** Prefixos que marcam uma linha de conversa entre agentes (fmtPergunta/fmtResposta/…). */
const PREFIXOS_COLAB = ["[pergunta de", "[resposta de", "[mensagem de", "[sem resposta"];

/** true quando a linha comeca EXATAMENTE com um dos prefixos de colaboracao. */
export function ehLinhaColab(texto: string): boolean {
  const t = typeof texto === "string" ? texto : "";
  return PREFIXOS_COLAB.some((p) => t.startsWith(p));
}

// Explorador de arquivos (S5 - CA-13c)

/** Um item da arvore: pastas tem `filhos`; arquivos nao trazem a chave. */
export type NoArvore = { nome: string; caminho: string; filhos?: NoArvore[] };

/** Filtra caminhos por um trecho, sem diferenciar maiusculas; busca vazia devolve tudo (CA-13c). */
export function filtrarArvore(caminhos: string[], busca: string): string[] {
  const b = typeof busca === "string" ? busca.toLowerCase() : "";
  if (!b) return caminhos;
  return caminhos.filter((c) => String(c).toLowerCase().includes(b));
}

/**
 * Monta a arvore de pastas/arquivos a partir de caminhos completos ('a/b.ts') (CA-13c): em cada
 * nivel, as PASTAS vem primeiro, depois os arquivos, cada grupo em ordem alfabetica. O `caminho`
 * de cada item e' o caminho completo (relativo) acumulado.
 */
export function arvoreDeCaminhos(caminhos: string[]): NoArvore[] {
  type Interno = { nome: string; caminho: string; pastas: Map<string, Interno>; arquivos: Set<string> };
  const raiz: Interno = { nome: "", caminho: "", pastas: new Map(), arquivos: new Set() };

  for (const bruto of caminhos) {
    const partes = String(bruto).split("/").filter((p) => p.length > 0);
    if (partes.length === 0) continue;
    let atual = raiz;
    for (let i = 0; i < partes.length - 1; i++) {
      const nome = partes[i];
      const caminho = partes.slice(0, i + 1).join("/");
      let filho = atual.pastas.get(nome);
      if (!filho) {
        filho = { nome, caminho, pastas: new Map(), arquivos: new Set() };
        atual.pastas.set(nome, filho);
      }
      atual = filho;
    }
    atual.arquivos.add(partes[partes.length - 1]);
  }

  const montar = (no: Interno): NoArvore[] => {
    const pastas: NoArvore[] = [...no.pastas.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((p) => ({ nome: p.nome, caminho: p.caminho, filhos: montar(p) }));
    const arquivos: NoArvore[] = [...no.arquivos]
      .sort((a, b) => a.localeCompare(b))
      .map((n) => ({ nome: n, caminho: no.caminho ? `${no.caminho}/${n}` : n }));
    return [...pastas, ...arquivos];
  };

  return montar(raiz);
}
