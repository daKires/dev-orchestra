import { useEffect, useReducer, useState } from "react";
import { aplicar, vazio, type Msg } from "@/lib/estado";

// SSE /events -> reducer. Mensagens chegam em rajada no replay: acumula e aplica 1x por frame.
export function useRuns() {
  const [estado, despachar] = useReducer(aplicar, vazio);
  const [conectado, setConectado] = useState(false);
  useEffect(() => {
    let fila: Msg[] = [];
    let agendado = 0;
    const es = new EventSource("/events");
    es.onopen = () => setConectado(true);
    es.onerror = () => setConectado(false);
    es.onmessage = (m) => {
      try { fila.push(JSON.parse(m.data)); } catch { return; }
      if (!agendado) agendado = requestAnimationFrame(() => { agendado = 0; const lote = fila; fila = []; despachar(lote); });
    };
    return () => { es.close(); cancelAnimationFrame(agendado); };
  }, []);
  return { estado, conectado };
}

// Relogio de 1s pra idade, duracao ao vivo e alerta de "sem resposta".
export function useAgora(): number {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  return agora;
}

// Estado de UI que sobrevive ao reload (per-viewer). Falha de storage = so nao persiste.
export function useLocal<T>(chave: string, inicial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem("hermes:" + chave); return s != null ? JSON.parse(s) : inicial; } catch { return inicial; }
  });
  const set = (n: T) => { setV(n); try { localStorage.setItem("hermes:" + chave, JSON.stringify(n)); } catch {} };
  return [v, set];
}
