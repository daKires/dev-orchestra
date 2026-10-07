// Novo navegador (F4 S6): dialog simples (nome + url) do botao "+ Navegador" da barra (atalho B).
// So' avisa o Canvas (onCriar) — criar o no' `nav:<slug>` (900x620) no centro visivel e' do Canvas.
import { useEffect, useState, type CSSProperties } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const FUNDO = "#1c1c1c";
const CABECALHO = "#222";
const BORDA = "#414141";
const DIVISOR = "#303030";
const RAIO = 14;
const FONTE = "400 13px/1.4 ui-sans-serif, system-ui, sans-serif";
const ROTULO = "400 11px/1 ui-sans-serif, system-ui, sans-serif";
const CAMPO: CSSProperties = {
  width: "100%", background: "#111", border: `1px solid ${BORDA}`, borderRadius: 7,
  color: "#fff", font: FONTE, padding: "7px 9px", outline: "none",
};

export type NovoNavegadorProps = {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  /** Recebe o nome e a url digitados; o Canvas cria o no' `nav:<slug>` no centro visivel. */
  onCriar: (nome: string, url: string) => void;
};

export function NovoNavegador({ aberto, onAberto, onCriar }: NovoNavegadorProps) {
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("https://");

  // Reabrir sempre comeca do zero.
  useEffect(() => { if (aberto) { setNome(""); setUrl("https://"); } }, [aberto]);

  const pode = !!nome.trim() && !!url.trim();
  const confirmar = () => {
    if (!pode) return;
    onCriar(nome.trim(), url.trim());
    onAberto(false);
  };

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-sm"
        style={{ background: FUNDO, border: `1px solid ${BORDA}`, borderRadius: RAIO }}
      >
        <DialogHeader className="gap-0 px-3 py-2" style={{ background: CABECALHO, borderBottom: `1px solid ${DIVISOR}` }}>
          <DialogTitle style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>Novo navegador</DialogTitle>
          <DialogDescription className="sr-only">Dê um nome e informe a url que o card deve abrir.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-3">
          <label className="flex flex-col gap-1.5">
            <span style={{ font: ROTULO, color: "#858585" }}>Nome</span>
            <input
              autoFocus
              value={nome}
              spellCheck={false}
              placeholder="pesquisa"
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
              className="cv-insp-campo"
              style={CAMPO}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span style={{ font: ROTULO, color: "#858585" }}>Url</span>
            <input
              value={url}
              spellCheck={false}
              placeholder="https://…"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
              className="cv-insp-campo"
              style={CAMPO}
            />
          </label>
        </div>

        <DialogFooter
          className="mx-0 mb-0 rounded-b-none px-3 py-2 sm:flex-row sm:justify-end"
          style={{ background: CABECALHO, borderTop: `1px solid ${DIVISOR}` }}
        >
          <Button type="button" variant="outline" onClick={() => onAberto(false)}>Cancelar</Button>
          <Button type="button" disabled={!pode} onClick={confirmar}><Globe />Abrir navegador</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NovoNavegador;
