import { useEffect, useMemo, useState } from "react";
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { linguagemDe, parseDiff, type LinhaDiff } from "@/lib/estado";
import { cn } from "@/lib/utils";

// Linguagens carregadas sob demanda (cada uma vira um chunk proprio no build).
export const LANGS: Record<string, () => Promise<unknown>> = {
  luau: () => import("shiki/dist/langs/luau.mjs"),
  lua: () => import("shiki/dist/langs/lua.mjs"),
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  json: () => import("shiki/dist/langs/json.mjs"),
  html: () => import("shiki/dist/langs/html.mjs"),
  css: () => import("shiki/dist/langs/css.mjs"),
  markdown: () => import("shiki/dist/langs/markdown.mjs"),
};
export const TEMA = "github-dark-default";
export const MAX_HL = 4000; // acima disso fica so com cores de +/- (highlight de diff gigante trava a aba)

let hl: Promise<HighlighterCore> | null = null;
function highlighter(): Promise<HighlighterCore> {
  hl ??= createHighlighterCore({
    themes: [import("shiki/dist/themes/github-dark-default.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return hl;
}

/**
 * Highlighter compartilhado (o DiffView e a previa de arquivo do Explorador usam o MESMO): devolve a
 * instancia e garante a linguagem carregada sob demanda (LANGS). `lang` fora de LANGS nem chega aqui.
 */
export async function highlighterPara(lang: string): Promise<HighlighterCore> {
  const h = await highlighter();
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage((await LANGS[lang]()) as any);
  return h;
}

async function tokenizar(linhas: LinhaDiff[], lang: string): Promise<ThemedToken[][] | null> {
  const h = await highlighterPara(lang);
  // ponytail: tokeniza o texto do diff como um documento so; comentario de bloco cortado no meio do hunk pode colorir errado
  const codigo = linhas.map((l) => (l.tipo === "hunk" || l.tipo === "meta" ? "" : l.texto)).join("\n");
  return h.codeToTokensBase(codigo, { lang: lang as any, theme: TEMA });
}

export function DiffView({ arquivo, patch }: { arquivo: string; patch: string }) {
  const linhas = useMemo(() => parseDiff(patch), [patch]);
  const lang = linguagemDe(arquivo);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  useEffect(() => {
    setTokens(null);
    if (!lang || linhas.length > MAX_HL) return;
    let vivo = true;
    tokenizar(linhas, lang).then((t) => { if (vivo) setTokens(t); }).catch(() => {});
    return () => { vivo = false; };
  }, [linhas, lang]);

  const add = linhas.filter((l) => l.tipo === "add").length;
  const rem = linhas.filter((l) => l.tipo === "rem").length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b px-4 font-mono text-[11.5px] text-muted-foreground">
        <span className="truncate text-foreground/85">{arquivo}</span>
        <span className="text-ok">+{add}</span>
        <span className="text-err">−{rem}</span>
        <span className="ml-auto">{lang ?? "texto"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {linhas.length === 0 && <p className="p-6 text-sm text-muted-foreground">Sem mudanças em relação ao HEAD.</p>}
        <table className="w-full border-collapse font-mono text-[12.5px] leading-5">
          <tbody>
            {linhas.map((l, i) => {
              if (l.tipo === "meta") return null;
              if (l.tipo === "hunk")
                return (
                  <tr key={i} className="bg-primary/[0.07] text-primary/80">
                    <td colSpan={4} className="px-4 py-0.5 text-[11.5px] select-none">{l.texto}</td>
                  </tr>
                );
              return (
                <tr key={i} className={cn(l.tipo === "add" && "bg-ok/[0.09]", l.tipo === "rem" && "bg-err/[0.09]")}>
                  <td className="w-12 border-r border-border/60 pr-2 text-right align-top text-muted-foreground/50 select-none">{l.velha ?? ""}</td>
                  <td className="w-12 border-r border-border/60 pr-2 text-right align-top text-muted-foreground/50 select-none">{l.nova ?? ""}</td>
                  <td className={cn("w-5 text-center align-top select-none", l.tipo === "add" ? "text-ok" : l.tipo === "rem" ? "text-err" : "")}>
                    {l.tipo === "add" ? "+" : l.tipo === "rem" ? "−" : ""}
                  </td>
                  <td className="pr-6 whitespace-pre">
                    {tokens?.[i]?.length ? tokens[i].map((t, j) => <span key={j} style={{ color: t.color }}>{t.content}</span>) : l.texto || " "}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
