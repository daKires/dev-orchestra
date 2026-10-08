// Estado do canvas de UM projeto (S4): snapshot por HTTP, ops em tempo real por SSE e envio otimista.
// Regra de conflito identica a do hub (aplicarOpsLocal, em lib/canvas.ts): a ultima escrita vence por
// item comparando `rev`. Nada de runtime do hub aqui — so' tipos, via `import type`.
import { useCallback, useEffect, useRef, useState } from "react";
import { aplicarOpsLocal } from "@/lib/canvas";
import type { MsgCanvasOp } from "@/lib/estado";
import type { Op, Snapshot } from "../../../canvas.ts";

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
  /** Aplica otimista e manda pro hub (POST /canvas/op com X-Hermes: 1). */
  enviar: (ops: Op[]) => void;
};

/**
 * Canvas de um projeto: GET /canvas?projeto pega o snapshot inicial; o EventSource('/events') aplica
 * os `{canvasOp}` do MESMO projeto (via aplicarOpsLocal); `enviar(ops)` aplica otimista primeiro e
 * depois faz o POST com rev = Date.now().
 */
export function useCanvas(projeto: string): CanvasRemoto {
  const [estado, setEstado] = useState<Snapshot>({ nos: [], arestas: [] });
  const [conectado, setConectado] = useState(false);
  const atual = useRef(projeto);
  atual.current = projeto;

  // Snapshot inicial do projeto. Trocar de projeto zera a vista ate' a resposta chegar.
  useEffect(() => {
    let vivo = true;
    setEstado({ nos: [], arestas: [] });
    fetch(`/canvas?projeto=${encodeURIComponent(projeto)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Snapshot | null) => {
        if (!vivo || !j) return;
        if (Array.isArray(j.nos) && Array.isArray(j.arestas)) setEstado({ nos: j.nos, arestas: j.arestas });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [projeto]);

  // SSE: as ops do canvas deste projeto entram no estado (o hub emite {canvasOp:{projeto,ops}}).
  useEffect(() => {
    const es = new EventSource("/events");
    es.onopen = () => setConectado(true);
    es.onerror = () => setConectado(false);
    es.onmessage = (m) => {
      let d: { canvasOp?: MsgCanvasOp } | null = null;
      try { d = JSON.parse(m.data); } catch { return; }
      const op = d?.canvasOp;
      if (!op || typeof op.projeto !== "string" || !Array.isArray(op.ops)) return;
      if (chaveProjeto(op.projeto) !== chaveProjeto(atual.current)) return; // so' o canvas deste projeto
      setEstado((s) => aplicarOpsLocal(s, op.ops));
    };
    return () => es.close();
  }, []);

  // Envio otimista: carimba rev = Date.now() em cada op, aplica local ANTES do eco do hub (a UI fica
  // responsiva) e so' entao faz o POST. O eco do hub apenas confirma (mesmo rev, mesma regra).
  const enviar = useCallback((ops: Op[]) => {
    if (!ops.length) return;
    const rev = Date.now();
    const carimbadas = ops.map((op) => ({ op: op.op, tipo: op.tipo, item: { ...op.item, rev } }) as Op);
    setEstado((s) => aplicarOpsLocal(s, carimbadas));
    void fetch("/canvas/op", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hermes": "1" },
      body: JSON.stringify({ projeto: atual.current, ops: carimbadas }),
    }).catch(() => {});
  }, []);

  return { estado, conectado, enviar };
}
