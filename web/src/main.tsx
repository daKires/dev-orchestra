import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Bug de render nao pode deixar o monitor da run em branco: mostra o erro e um botao de recarregar.
class Falha extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) { return { erro }; }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-xl space-y-3">
          <p className="text-sm font-medium text-err">A interface quebrou ao desenhar esta tela.</p>
          <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{String(this.state.erro.stack ?? this.state.erro)}</pre>
          <button onClick={() => location.reload()} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted">Recarregar</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><Falha><App /></Falha></StrictMode>);
