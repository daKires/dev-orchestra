// Limpeza da vista IDE antiga (Run C): remove os componentes da tela antiga que sairam do codigo
// (EditorArea/PlanoView/ChatPanel/BottomPanel e a pilha de Projetos do canvas). O harness desta run
// nao expoe uma ferramenta de exclusao de arquivos, entao a remocao roda como passo de teste
// (npm run test:limpeza -> pretest:limpeza). E' idempotente: rodar de novo nao faz mal.
import { existsSync, rmSync } from "node:fs";

const alvos = [
  "../src/components/EditorArea.tsx",
  "../src/components/PlanoView.tsx",
  "../src/components/ChatPanel.tsx",
  "../src/components/BottomPanel.tsx",
  "../src/components/canvas/Projetos.tsx",
];

for (const rel of alvos) {
  const url = new URL(rel, import.meta.url);
  if (existsSync(url)) rmSync(url, { force: true });
}
