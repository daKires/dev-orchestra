// Estado do canvas de UM projeto (S4): snapshot por HTTP, ops em tempo real por SSE e envio otimista.
// Regra de conflito identica a do hub (aplicarOpsLocal, em lib/canvas.ts): a ultima escrita vence por
// item comparando `rev`. Nada de runtime do hub aqui — so' tipos, via `import type`.
import { useCallback, useEffect, useRef, useState } from "react";
import { aplicarOpsLocal, Historico, inversoDe } from "@/lib/canvas";
import type { MsgCanvasOp } from "@/lib/estado";
import { assinarEventos } from "@/lib/sse";
import type { Op, Snapshot } from "../../../src/canvas.ts";

/**
 * Chave canonica do projeto: separadores uniformes ('/'), sem barra final e minusculo. Mesma pasta
 * escrita de formas diferentes (D:\Proj vs d:/proj/) e' o MESMO canvas — como idProjeto no hub, mas
 * sem node:crypto (nao existe no browser).
 */
export function chaveProjeto(caminho: string): string {
  return caminho.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export type CanvasRemoto = {
  /** Grafo atual do projeto (nos + arestas). */
  estado: Snapshot;
  /** SSE vivo? false = a UI mostra "reconectando…" e bloqueia edicao. */
  conectado: boolean;
  /** Snapshot do GET /canvas ja' chegou (ou falhou)? Antes disso o grafo so' tem as runs. */
  carregado: boolean;
  /** Aplica otimista, manda pro hub (POST /canvas/op com X-Dev-Orchestra: 1) e registra no historico. */
  enviar: (ops: Op[]) => void;
  /** Desfaz a ultima acao LOCAL (ops inversas com rev novo); nao entra no historico. */
  desfazer: () => void;
  /** Refaz a ultima acao desfeita (ops originais com rev novo); nao entra no historico. */
  refazer: () => void;
};

/**
 * Canvas de um projeto: GET /canvas?projeto pega o snapshot inicial; o EventSource('/events') aplica
 * os `{canvasOp}` do MESMO projeto (via aplicarOpsLocal); `enviar(ops)` aplica otimista primeiro e
 * depois faz o POST com rev = Date.now().
 */
export function useCanvas(projeto: string): CanvasRemoto {
  const [estado, setEstado] = useState<Snapshot>({ nos: [], arestas: [] });
  const [conectado, setConectado] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const atual = useRef(projeto);
  atual.current = projeto;
  // Ultimo estado renderizado: base para o inverso de cada acao local (o "antes").
  const antes = useRef(estado);
  antes.current = estado;
  // Pilha de desfazer/refazer das acoes LOCAIS (as ops do SSE nao entram aqui).
  const historico = useRef(new Historico());

  // Snapshot inicial do projeto. Trocar de projeto zera a vista ate' a resposta chegar.
  useEffect(() => {
    let vivo = true;
    setEstado({ nos: [], arestas: [] });
    setCarregado(false);
    historico.current = new Historico(); // historico e' por projeto
    fetch(`/canvas?projeto=${encodeURIComponent(projeto)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Snapshot | null) => {
        if (!vivo || !j) return;
        if (Array.isArray(j.nos) && Array.isArray(j.arestas)) setEstado({ nos: j.nos, arestas: j.arestas });
      })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregado(true); });
    return () => { vivo = false; };
  }, [projeto]);

  // SSE: as ops do canvas deste projeto entram no estado (o hub emite {canvasOp:{projeto,ops}}).
  useEffect(() => {
    return assinarEventos({ estado: setConectado, msg: (m) => {
      let d: { canvasOp?: MsgCanvasOp } | null = null;
      try { d = JSON.parse(m.data); } catch { return; }
      const op = d?.canvasOp;
      if (!op || typeof op.projeto !== "string" || !Array.isArray(op.ops)) return;
      if (chaveProjeto(op.projeto) !== chaveProjeto(atual.current)) return; // so' o canvas deste projeto
      setEstado((s) => aplicarOpsLocal(s, op.ops));
    } });
  }, []);

  // Envio cru (sem historico): carimba rev = Date.now() em cada op, aplica local ANTES do eco do hub
  // (a UI fica responsiva) e so' entao faz o POST. O eco do hub apenas confirma (mesmo rev, mesma
  // regra). Usado tanto pelas acoes locais quanto pelo proprio desfazer/refazer.
  const postar = useCallback((ops: Op[]) => {
    if (!ops.length) return;
    const rev = Date.now();
    const carimbadas = ops.map((op) => ({ op: op.op, tipo: op.tipo, item: { ...op.item, rev } }) as Op);
    setEstado((s) => aplicarOpsLocal(s, carimbadas));
    void fetch("/canvas/op", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dev-Orchestra": "1" },
      body: JSON.stringify({ projeto: atual.current, ops: carimbadas }),
    }).catch(() => {});
  }, []);

  // Unico ponto de historico: TODA acao local passa por aqui e registra o par (inverso, ops originais)
  // usando o estado ANTES da acao. Um movimento de arrasto chega como UM lote (no fim do arrasto), logo
  // vira UMA unica acao. As ops recebidas pelo SSE NAO passam por enviar (vem direto no EventSource).
  const enviar = useCallback((ops: Op[]) => {
    if (!ops.length) return;
    historico.current.registrar(inversoDe(antes.current, ops, Date.now()), ops);
    postar(ops);
  }, [postar]);

  // Desfazer/refazer: re-carimba rev = Date.now() (via postar) e NAO registra no historico.
  const desfazer = useCallback(() => {
    const ops = historico.current.desfazer();
    if (ops) postar(ops);
  }, [postar]);

  const refazer = useCallback(() => {
    const ops = historico.current.refazer();
    if (ops) postar(ops);
  }, [postar]);

  return { estado, conectado, carregado, enviar, desfazer, refazer };
}
