// Agentes do canvas de UM projeto (F2 S5a): o hub ja' tem as rotas /agentes; aqui so' consumimos.
// Snapshot por HTTP (GET /agentes?projeto=), lista e transcricoes ao vivo pelo SSE /events e as acoes
// de conversa (POST). Nada de runtime do hub/OpenCode aqui — no maximo tipos, via `import type`.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversa } from "@/lib/colab";

/** Resumo de um agente como o hub devolve em GET /agentes e no SSE {agentes}. */
export type AgenteVisivel = {
  id: string; nome: string; papel: string; modelo: string; cwd: string; origem: string; status: string;
  /** 'opencode' (padrao) ou 'claude': decide qual card do canvas renderiza o agente (F4/S6). */
  tipo: string;
  /** true enquanto o agente esta trabalhando (busy do OpenCode); base do ponto pulsante do card. */
  ocupado: boolean;
  /** true quando o Claude esta esperando uma resposta/permissao sua (hooks do Claude Code). */
  aguardando: boolean;
};

/** Linha da transcricao do chat do agente (mesma forma da Linha do hub). */
export type Linha = { id: string; msg: string; tipo: string; estado?: string; texto: string };

export type Agentes = {
  agentes: AgenteVisivel[];
  linhasPorId: Record<string, Linha[]>;
  /** Conversas pendentes entre agentes do projeto (SSE {conversas}); base do balao das arestas. */
  conversas: Conversa[];
  carregarHistorico: (id: string) => void;
  mensagem: (id: string, texto: string) => void;
  abortar: (id: string) => void;
  encerrar: (id: string) => void;
  reiniciar: (id: string) => void;
  trocarModelo: (id: string, modelo: string) => void;
  modelos: (cwd: string) => Promise<string[]>;
  /**
   * Assina a saida do PTY ({pty}) de UM agente: o callback recebe os bytes em base64, na ordem do
   * SSE, e a funcao devolvida cancela a assinatura. Usado pelo card Claude (F4/S6).
   */
  assinarPty: (id: string, cb: (dados: string) => void) => () => void;
};

/** Chave canonica de projeto: separadores '/', sem barra final, minusculo (mesma regra do hub). */
function canonico(p: string): string {
  return String(p ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** O lote {agentes} do SSE e' do projeto do agente; se o resumo declarar OUTRO projeto, fica de fora. */
function doProjeto(a: AgenteVisivel, projeto: string): boolean {
  const p = (a as AgenteVisivel & { projeto?: unknown }).projeto;
  return typeof p !== "string" || !p.trim() || canonico(p) === canonico(projeto);
}

/** POST de uma acao do agente: header X-Hermes: 1 + corpo JSON; falha de rede nao quebra a UI. */
function post(id: string, acao: string, corpo: unknown): void {
  void fetch(`/agentes/${encodeURIComponent(id)}/${acao}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1" }, body: JSON.stringify(corpo),
  }).catch(() => {});
}

/**
 * Agentes do projeto: GET /agentes?projeto= na montagem (trocar de projeto zera a vista ate' a
 * resposta); o EventSource('/events') aplica {agentes} (substitui a lista do projeto),
 * {agenteLinhas} (substitui a transcricao daquele id) e {conversas} (pendentes entre agentes).
 * As acoes chamam as rotas POST do hub.
 */
export function useAgentes(projeto: string): Agentes {
  const [agentes, setAgentes] = useState<AgenteVisivel[]>([]);
  const [linhasPorId, setLinhasPorId] = useState<Record<string, Linha[]>>({});
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const atual = useRef(projeto); // pro handler do SSE (o stream nao e' reaberto ao trocar de projeto)
  atual.current = projeto;
  // Sem projeto (string vazia/so' espacos) NADA de agentes: nenhum GET /agentes e nenhum SSE — a lista
  // fica vazia. Assim que o projeto aparece, o snapshot e o stream ligam (o stream segue unico).
  const ativo = canonico(projeto) !== "";
  // Assinantes da saida do PTY por id (card Claude, F4/S6): o SSE {pty} entrega so' pra quem assinou.
  const ouvintesPty = useRef(new Map<string, Set<(dados: string) => void>>());

  // Snapshot inicial: a lista do SSE so' chega quando algo muda no hub.
  useEffect(() => {
    let vivo = true;
    setAgentes([]);
    setLinhasPorId({});
    setConversas([]);
    if (!ativo) return () => { vivo = false; };
    fetch(`/agentes?projeto=${encodeURIComponent(projeto)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: AgenteVisivel[] | null) => { if (vivo && Array.isArray(j)) setAgentes(j); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [ativo, projeto]);

  // SSE: so' {agentes} (lista inteira), {agenteLinhas} (transcricao inteira de um id) e {conversas}
  // (pendentes entre agentes) importam. Sem projeto nao abre o stream (nada de SSE de agentes).
  useEffect(() => {
    if (!ativo) return;
    const es = new EventSource("/events");
    es.onmessage = (m) => {
      let d: {
        agentes?: AgenteVisivel[];
        agenteLinhas?: { id: string; linhas: Linha[] };
        conversas?: Conversa[];
        pty?: { id: string; dados: string };
      } | null = null;
      try { d = JSON.parse(m.data); } catch { return; }
      // Saida do PTY de um agente Claude: entrega aos assinantes daquele id (card Claude).
      const pty = d?.pty;
      if (pty && typeof pty.id === "string" && typeof pty.dados === "string") {
        const assinantes = ouvintesPty.current.get(pty.id);
        if (assinantes) for (const cb of assinantes) { try { cb(pty.dados); } catch {} }
      }
      if (Array.isArray(d?.agentes)) {
        setAgentes(d.agentes.filter((a) => a && typeof a.id === "string" && doProjeto(a, atual.current)));
      }
      const al = d?.agenteLinhas;
      if (al && typeof al.id === "string" && Array.isArray(al.linhas)) {
        setLinhasPorId((l) => ({ ...l, [al.id]: al.linhas }));
      }
      if (Array.isArray(d?.conversas)) {
        setConversas(d.conversas.filter((c) => c && typeof c.q === "string" && typeof c.de === "string" && typeof c.para === "string"));
      }
    };
    return () => es.close();
  }, [ativo]);

  // Recarrega a lista do projeto atual (GET /agentes?projeto=): usado pelo reiniciar pra refletir o
  // status novo sem esperar o SSE (que so' chega quando o hub mudar algo).
  const recarregar = useCallback(() => {
    const projeto = atual.current;
    if (!canonico(projeto)) return; // projeto vazio: nada de GET /agentes
    void fetch(`/agentes?projeto=${encodeURIComponent(projeto)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: AgenteVisivel[] | null) => { if (Array.isArray(j)) setAgentes(j); })
      .catch(() => {});
  }, []);

  // Historico do agente (GET /agentes/:id/historico): preenche SO' quando ainda nao houver linhas.
  const carregarHistorico = useCallback((id: string) => {
    void fetch(`/agentes/${encodeURIComponent(id)}/historico`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Linha[] | null) => {
        if (!Array.isArray(j)) return;
        setLinhasPorId((l) => (l[id]?.length ? l : { ...l, [id]: j }));
      })
      .catch(() => {});
  }, []);

  const mensagem = useCallback((id: string, texto: string) => { if (texto) post(id, "mensagem", { texto }); }, []);
  const abortar = useCallback((id: string) => post(id, "abortar", {}), []);

  // Encerrar tambem some com o agente e a transcricao na hora (o hub nao reemite a lista nessa acao).
  const encerrar = useCallback((id: string) => {
    post(id, "encerrar", {});
    setAgentes((a) => a.filter((x) => x.id !== id));
    setLinhasPorId((l) => { const novo = { ...l }; delete novo[id]; return novo; });
  }, []);

  // Reiniciar a sessao (POST /agentes/:id/reiniciar): o hub recria a sessao do OpenCode. Ao responder,
  // recarregamos a lista do projeto (status pode voltar a 'ok'/'falhou') e zeramos a transcricao do id.
  const reiniciar = useCallback((id: string) => {
    if (!id) return;
    void fetch(`/agentes/${encodeURIComponent(id)}/reiniciar`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1" }, body: JSON.stringify({}),
    })
      .then(() => {
        recarregar();
        setLinhasPorId((l) => { const novo = { ...l }; delete novo[id]; return novo; });
      })
      .catch(() => {});
  }, [recarregar]);

  // Trocar o modelo nao volta pelo SSE: reflete localmente alem de mandar pro hub.
  const trocarModelo = useCallback((id: string, modelo: string) => {
    post(id, "modelo", { modelo });
    setAgentes((a) => a.map((x) => (x.id === id ? { ...x, modelo } : x)));
  }, []);


  // Assinatura da saida do PTY de um agente (SSE {pty}): devolve o cancelamento da assinatura.
  const assinarPty = useCallback((id: string, cb: (dados: string) => void) => {
    if (!id) return () => {};
    const mapa = ouvintesPty.current;
    let conjunto = mapa.get(id);
    if (!conjunto) { conjunto = new Set(); mapa.set(id, conjunto); }
    conjunto.add(cb);
    return () => {
      conjunto!.delete(cb);
      if (conjunto!.size === 0) mapa.delete(id);
    };
  }, []);

  // Modelos disponiveis na cwd (GET /agentes/modelos?cwd=): [] quando o serve ainda nao subiu.
  const modelos = useCallback(async (cwd: string): Promise<string[]> => {
    try {
      const r = await fetch(`/agentes/modelos?cwd=${encodeURIComponent(cwd)}`);
      if (!r.ok) return [];
      const j: unknown = await r.json();
      return Array.isArray(j) ? j.filter((m): m is string => typeof m === "string") : [];
    } catch { return []; }
  }, []);

  return { agentes, linhasPorId, conversas, carregarHistorico, mensagem, abortar, encerrar, reiniciar, trocarModelo, modelos, assinarPty };
}
