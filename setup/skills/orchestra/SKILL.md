---
name: orchestra
description: Use quando o usuario disser "use o orchestra" (ou pedir pra implementar uma feature com o orchestra/swarm). Voce planeja em slices e escreve os testes; o swarm do MCP dev-orchestra implementa e faz commit local; voce revisa.
---

Voce (a ferramenta) e o ORQUESTRADOR e o REVISOR. Voce e o PLANEJADOR; quem IMPLEMENTA e o swarm
do servidor MCP `dev-orchestra`, chamado pela tool `executar_orchestra`. NAO implemente codigo voce
mesmo — EXCETO os testes (sao a spec executavel, passo 5) — e NAO use subagentes.

A feature vem do pedido do usuario na conversa (nao ha argumento de comando): se ele nao disse o que
quer, pergunte e PARE ate ele responder.

Antes de planejar, LEIA a skill `plan-sdd` (instalada junto com esta) e siga o metodo SDD pra montar
o plano: spec com criterios de aceite, esclarecer TODA ambiguidade perguntando ao usuario, os
portoes, e tarefas + validacao.

As tools sao do servidor MCP `dev-orchestra`: `executar_orchestra`, `status_orchestra`,
`doctor_orchestra` e `abrir_run`. Cada ferramenta pode aparecer com um prefixo do seu cliente, por exemplo
`mcp__dev-orchestra__executar_orchestra` ou `dev-orchestra_executar_orchestra` — use a forma que o
seu cliente expuser.

Passos (em PT-BR):
1. Se o usuario nao disse a feature, pergunte qual feature ele quer e PARE ate ele responder.
2. Explore o projeto na pasta atual (estrutura, arquivos relevantes, convencoes).
3. Monte um PLANO em SLICES (nao uma tarefa por arquivo): cada slice e uma unidade coerente de
   trabalho que UM agente resolve sozinho, podendo tocar varios arquivos. Formato de cada slice:
   { tarefa: titulo curto, arquivos_alvo: [caminhos relativos que ela deve mexer], descricao: o que
   fazer }. Cada agente le/edita arquivos e roda comandos de verificacao permitidos por conta propria,
   entao a descricao pode ser de alto nivel (o "o que", nao o "passo a passo"). Slices rodam EM SERIE.
   Cada slice com logica testavel tem UM arquivo de teste proprio + um comando que roda SO ele, e um
   runner roda todos. O runner vai SO no gate, NUNCA em `override.cmds`: ele inclui testes de slices
   futuras, que falham ate elas rodarem e viram iteracao falsa. A allowlist tem so os comandos de
   teste por slice (inclusive das suites que ja existiam) + build/lint. No plano, liste por slice, em
   PT-BR, o que os testes dela checam (criterios, nao codigo). A descricao de cada slice cita o
   comando de teste dela e diz: "testes existentes sao imutaveis; se falhar, conserte o codigo (pode
   criar testes extras em arquivo novo)". Mostre tambem `override.cmds` (allowlist) e `override.gate`.
   Mostre o plano legivel e PERGUNTE se o usuario APROVA. PARE e espere a resposta (o "sim").
4. So apos a aprovacao, ANTES de escrever os testes, monte os comandos com esta checklist (os
   comandos rodam pelo shell do bridge, `cmd.exe` no Windows, NAO pelo seu shell):
   - Script sh sem extensao no PATH nao roda la: use o `.cmd` do binario (ex.:
     `node_modules\.bin\pnpm.CMD ...`).
   - NUNCA `npm exec`/`pnpm exec` (imprime 'Command "x" not found' ate com teste falhando): use o
     script (`pnpm --filter api test -- arq.spec.ts`) ou o bin direto. O bridge RECUSA.
   - NUNCA comando com efeito fora do git (migrate, db push, seed, reset, drop) na allowlist/gate: o
     REVERTER nao desfaz banco. O bridge RECUSA (olha tambem o corpo do script). `db:generate` pode.
     Migration pendente: VOCE gera/aplica depois de revisar o diff, com consentimento do usuario.
   - Pacote de workspace tem que resolver o `src`, nao um `dist` velho (alias/exports/conditions) —
     senao o teste falha com "undefined" igual a falta de implementacao e NUNCA passa. Confira o node
     e os bindings opcionais que o projeto usa.
   - Comando que precisa de servico (banco do e2e) exige o servico de pe antes da run.
5. Escreva os testes (spec executavel):
   - rode `git branch --show-current`. Se JA estiver num branch `orchestra/...`, NAO crie branch: use
     esse. Senao, `git checkout -b orchestra/<slug>` — slug = feature em minusculas, sem acento, todo
     trecho nao-alfanumerico vira `-`, sem `-` nas pontas, cortado em 40 chars (mesma regra do bridge).
   - escreva um arquivo de teste por slice + o runner.
   - DOCTOR (obrigatorio): chame `doctor_orchestra` com cwd e o MESMO override que vai pra run. Ele
     roda cada comando pelo shell que os agentes usam (NAO confie no seu terminal). Exija: nenhum
     [AMBIENTE] nem [RECUSADO] (se houver, conserte e rode de novo; nao chame a run). E, em CADA
     [esperada], LEIA a saida: tem que falhar porque falta o simbolo/arquivo que a slice vai criar
     (ex.: `Cannot find module './profile.service'`, export ausente do arquivo-alvo), NAO por erro de
     sintaxe/require no proprio teste, nem por `undefined` vindo de pacote resolvido pelo `dist`.
   - commit `test: spec de <feature>` nesse branch. Esse commit vira a baseline: o REVERTER desfaz o
     codigo do swarm e mantem os testes.
6. Chame a tool `executar_orchestra` com:
   - cwd: caminho absoluto da pasta de trabalho atual
   - feature: a descricao da feature
   - plano: o array de slices que voce montou
   - override: { cmds: [...comandos conferidos: teste de cada slice + build/lint, SEM o runner],
     gate: [...runner de todos os testes + build/lint] }
   Os agentes tem buscar/listar/ler_arquivo pra explorar e editar_arquivo (troca de trecho) pra mudar
   arquivo existente; nao coloque git/grep na allowlist pra isso.
   A tool e ASSINCRONA: volta na hora com `RUN INICIADA: <runId>`. Chame `status_orchestra` com esse
   runId EM LOOP (cada chamada espera ~20s) enquanto vier `RODANDO`; pare quando vier o painel final.
   Cancelar e so pelo botao do dashboard (parar o chat NAO cancela a run).
7. Mostre INTEGRALMENTE o painel final que `status_orchestra` retornar e, no fim, REPITA a linha
   `run: <url>` que vem na propria resposta: e o link direto desta run no dashboard. Lembre o usuario
   que o progresso ao vivo (cada slice, tool call, o gate e o diff crescendo) fica nesse dashboard —
   o painel aqui e so o resumo final. Se o usuario pedir "abre a run", chame a tool `abrir_run` (sem
   argumento ela abre a run mais recente desta sessao; com `runId`, aquela run).
8. REVISE o resultado e BARRE se quebrou. Rode `git diff` (e/ou leia o painel). NAO declare sucesso
   se: o STATUS for NEEDS-REVIEW, GATE-FAILED, ENV-FAILED, FAILED ou CANCELED, houver slices com
   [!!]/motivo, ou o diff parecer quebrar algo (arquivo que perdeu estrutura, ficou vazio, encolheu
   demais). Nesse caso, avise o usuario com clareza e OFERECA reverter com o comando REVERTER do
   painel (`git checkout <baseline> -- .`). So confirme sucesso (branch, arquivos, como testar) se o
   diff estiver coerente. NAO faca push/PR a menos que o usuario peca.

QUANDO DER ERRADO: o swarm NAO repara e NAO revisa sozinho — quem le a saida e corrige e VOCE. Trate cada falha
conforme o STATUS:
- GATE-FAILED: o codigo gerado nao passou nos comandos do `override.gate` — NENHUM commit foi feito.
  A SAIDA do comando que falhou vem DEPOIS do painel; LEIA, diga ao usuario o que corrigir e chame
  uma NOVA run so com slices de CORRECAO (nao replaneje a feature toda), oferecendo o REVERTER se for
  o caso.
- NEEDS-REVIEW com slice "pulada": uma slice falhou e a run parou ali (sem gate, sem commit). Mostre
  o motivo da slice que falhou e REPLANEJE a partir dela.
- ENV-FAILED: falha de AMBIENTE (executavel, node/binding, pacote, servico fora do ar, timeout) ou
  comando RECUSADO (exec, migrate...). Nada foi commitado. Mostre o comando e a saida, conserte o
  AMBIENTE (nao o codigo), rode `doctor_orchestra` ate ficar limpo e so entao chame a run de novo.
  NAO replaneje o codigo por causa disso.
- CANCELED: o usuario cancelou pelo dashboard. Nada foi commitado; as edicoes ficaram no working tree.
  Mostre o REVERTER e pergunte se ele quer reverter ou aproveitar as edicoes.
- FAILED: mostre a mensagem do painel e oriente conforme a causa.
- "ja existe run <id> rodando": outra run ainda roda; acompanhe/espere com `status_orchestra` ou
  cancele no dashboard.
- agente quer rodar build/teste mas cai em "comando nao permitido": faltou o comando em
  `override.cmds`.
- CHAVE INVALIDA ou erro do provedor: rode `npx github:daKires/dev-orchestra` de novo pra trocar
  provedor/modelo/chave.
