// UM EventSource('/events') por aba, compartilhado pelos hooks. Antes cada hook abria o seu (5 por aba):
// o Chrome so' deixa 6 conexoes HTTP/1.1 por host, entao a 2a aba ficava sem conexao ("reconectando…",
// arvore/canvas pendurados). O hub manda o replay so' na abertura da conexao, entao quem assina depois
// recebe o buffer da conexao atual (zerado a cada (re)abertura).
// ponytail: buffer cresce com a sessao (sem {pty}, que e' terminal ao vivo); limitar se pesar.
type Ouvinte = { msg: (m: MessageEvent<string>) => void; estado?: (ok: boolean) => void };

const ouvintes = new Set<Ouvinte>();
let es: EventSource | null = null;
let buffer: MessageEvent<string>[] = [];
let aberto = false;

export function assinarEventos(o: Ouvinte): () => void {
  if (!es) {
    es = new EventSource("/events");
    es.onopen = () => { aberto = true; buffer = []; for (const x of ouvintes) x.estado?.(true); };
    es.onerror = () => { aberto = false; for (const x of ouvintes) x.estado?.(false); };
    es.onmessage = (m: MessageEvent<string>) => {
      if (!m.data.startsWith('{"pty"')) buffer.push(m);
      for (const x of ouvintes) x.msg(m);
    };
  }
  ouvintes.add(o);
  if (aberto) o.estado?.(true);
  for (const m of buffer) o.msg(m);
  return () => {
    ouvintes.delete(o);
    if (ouvintes.size) return;
    es?.close(); es = null; buffer = []; aberto = false;
  };
}
