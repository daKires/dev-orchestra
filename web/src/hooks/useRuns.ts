import { useEffect, useReducer, useState } from "react";
import { aplicar, vazio, type Msg } from "@/lib/estado";

// SSE /events -> reducer. O replay inicial chega em rajada e so' e' aplicado quando o hub manda
// {pronto} (senao uma run aparece pela metade, ex. "interrompida"); depois, 1 lote por frame.
export function useRuns() {
  const [estado, despachar] = useReducer(aplicar, vazio);
  const [conectado, setConectado] = useState(false);
  useEffect(() => {
    let fila: Msg[] = [];
    let agendado = 0;
    let pronto = false;
    const liberar = () => { pronto = true; const lote = fila; fila = []; despachar(lote); };
    const reserva = setTimeout(liberar, 2000); // hub sem {pronto}: nao segura pra sempre
    const es = new EventSource("/events");
    es.onopen = () => setConectado(true);
    es.onerror = () => setConectado(false);
    es.onmessage = (m) => {
      let d: Msg & { pronto?: boolean };
      try { d = JSON.parse(m.data); } catch { return; }
      if (d.pronto) { if (!pronto) { clearTimeout(reserva); liberar(); } return; }
      fila.push(d);
      if (pronto && !agendado) agendado = requestAnimationFrame(() => { agendado = 0; const lote = fila; fila = []; despachar(lote); });
    };
    return () => { es.close(); cancelAnimationFrame(agendado); clearTimeout(reserva); };
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
    try { const s = localStorage.getItem("dev-orchestra:" + chave); return s != null ? JSON.parse(s) : inicial; } catch { return inicial; }
  });
  const set = (n: T) => { setV(n); try { localStorage.setItem("dev-orchestra:" + chave, JSON.stringify(n)); } catch {} };
  return [v, set];
}
