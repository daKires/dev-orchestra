---
name: plan-sdd
description: Modo de planejamento Spec-Driven Development (SDD) — produz um plano de implementação extremamente preciso separando O QUÊ (spec de comportamento + critérios de aceite testáveis) do COMO (arquitetura, arquivos, tarefas), e resolvendo TODA ambiguidade com o usuário ANTES de planejar. Use ao planejar uma feature/mudança não-trivial antes de codar, quando o usuário digitar /plan-sdd ou pedir "planeja isso", "cria um plano", "faz um spec", "quero um plano certeiro", ou entrar em modo de plano pra algo com requisitos pouco claros. Não use pra mudança trivial (1-3 linhas, rename, typo) — SDD nesses casos é overkill.
---

# Plan-SDD — Planejamento Spec-Driven

Modo de plano turbinado com a disciplina do **Spec-Driven Development**. A ideia central: um plano
erra quando o requisito é vago e o modelo **adivinha** — aí o plano fica certo na forma e errado no
conteúdo. SDD inverte isso: a **spec** (o que o software deve fazer, em critérios verificáveis) vira
a autoridade, e o plano técnico só existe pra realizá-la. Nada de arquitetura enquanto houver
ambiguidade aberta.

Isto **não substitui** o modo de plano — enriquece. Você continua explorando o código com agentes
`Explore`, escrevendo no arquivo de plano e terminando em `ExitPlanMode`. O que muda é a ordem e o
rigor: primeiro a spec e o esclarecimento, depois o COMO.

## Princípios (a constituição — enxuta de propósito)

1. **A spec é a autoridade.** Descreva O QUÊ (comportamento) antes do COMO (implementação). O
   código serve à spec, não o contrário. Se na validação o código diverge da spec, a decisão é
   consciente: conserta o código ou revisa a spec — mas a spec manda.
2. **Zero ambiguidade antes de planejar.** Todo desconhecido vira `[ESCLARECER: pergunta]` e é
   resolvido *antes* de qualquer decisão técnica. Este é o pulo do gato da precisão — é o que
   impede o modelo de "chutar plausível e seguir em frente". **Decisão do usuário NUNCA é assumida
   por default — sempre vira pergunta.** Toda rodada de SDD devolve perguntas ao usuário; zero
   perguntas só é aceitável em mudança trivial (que nem dispara SDD).
3. **Rigor mínimo que remove ambiguidade.** Escreva a spec no nível em que dois leitores entendem a
   mesma coisa — e para por aí. Spec detalhada demais vira pseudo-código e perde o ganho de
   abstração (é anti-pattern, ver abaixo). **Isto é sobre o TAMANHO da spec, não sobre pular
   perguntas — na dúvida entre perguntar e assumir, SEMPRE pergunte.**
4. **Simplicidade e anti-abstração.** Reuse código/padrão que já existe, nada especulativo, cada
   arquivo/dependência nova precisa se justificar. Honre as convenções do projeto
   (CLAUDE.md/AGENTS.md).
5. **Rastreabilidade.** Toda tarefa aponta pra um requisito da spec; todo requisito aponta pra uma
   verificação concreta. Sem requisito órfão, sem tarefa que ninguém pediu.

## O processo (4 passos)

### 1. Especificar (O QUÊ)

Escreva uma spec **compacta**, sem detalhe de implementação:

- **Comportamento / histórias** — "como <ator>, quero <objetivo> pra <motivo>".
- **Critérios de aceite testáveis**, **numerados `CA-1`, `CA-2`…**, em Dado/Quando/Então:
  ```
  CA-1
  Dado  que o carrinho está vazio
  Quando eu adiciono o item "X"
  Então o carrinho passa a ter 1 item
  ```
  Cada critério tem que ser verificável — se não dá pra checar, reescreva. A numeração é a
  âncora de rastreabilidade: perguntas de esclarecimento e tarefas apontam pro `CA-N`.
- **Casos de borda e condições de erro** (o que acontece quando dá ruim).
- **Requisitos não-funcionais** que importam aqui (performance, segurança, PT-BR na UI, etc.).
- **Fora de escopo** — explícito, pra ninguém "achar" que ia estar incluso.

Marque **cada** incerteza com `[ESCLARECER: pergunta específica]` em vez de inventar uma resposta.
Não escreva COMO (framework, tabela, endpoint) aqui — isso é o passo 3.

**Varredura de ambiguidade — passe a spec por esta grade** antes de declará-la pronta. Pra cada
linha, marque internamente Claro / Parcial / Ausente; todo Parcial/Ausente que muda a implementação
ou a validação vira um `[ESCLARECER]` (o que não muda nada, ignore — não infle a spec):

- **Escopo funcional** — objetivos, sucesso, o que fica *fora*, diferença entre papéis/atores.
- **Dados & entidades** — campos, relações, unicidade/identidade, transições de estado, volume.
- **Fluxo & UX** — jornada crítica, estados de erro/vazio/carregando, acessibilidade.
- **Não-funcionais** — performance, segurança/autz, privacidade/LGPD, observabilidade.
- **Integrações externas** — serviços/APIs, formatos de import/export, modos de falha.
- **Casos de borda** — cenários negativos, concorrência/conflito, limites/rate.
- **Restrições & trade-offs** — limites técnicos, alternativas rejeitadas.
- **Terminologia** — termo canônico único; sem sinônimo solto pro mesmo conceito.
- **Sinais de conclusão** — cada critério é objetivamente checável? adjetivo vago
  ("robusto", "rápido", "intuitivo") está quantificado?
- **Placeholders** — TODO, `???`, decisão em aberto.

### 2. Esclarecer (portão OBRIGATÓRIO — sempre pergunte, nunca assuma)

- Junte todos os `[ESCLARECER]` da spec.
- **Responda pelo código o que o código sabe** — lance agentes `Explore` pra investigar padrões,
  utilitários, contratos existentes. Muita "ambiguidade" some só de ler o repo.
- **Tudo que só o usuário decide (regra de negócio, prioridade, escopo, trade-off, segurança) →
  `AskUserQuestion`. SEMPRE pergunte — NUNCA assuma um default, "escolha razoável" ou "resolvo
  depois" pra uma decisão que é do usuário. Não existe rodada de SDD sem perguntas ao usuário.**
- **Qualidade de cada pergunta** (o *como* pergunta muda o quanto a resposta vale):
  - **Interrogativa que se sustenta sozinha** — a pergunta faz sentido sem abrir a spec. Nunca use
    um rótulo ou ID como a pergunta ("Tolerância de inadimplência (CA-12)" é inválido). Cite o
    `CA-N` como **sufixo de rastreio**, não como o enunciado: *"Quando o pagamento atrasa, a vaga
    do aluno some da fila na hora ou fica reservada até o fim da aula? (CA-12)"*.
  - **Linha "por que importa"** antes das opções — o que está em jogo / o custo técnico da escolha:
    *"Se for por CT, precisa de coluna nova + tela de config; se global, é uma constante."* Sempre
    que a escolha tiver consequência (schema, arquivos, UX, escopo) — quase sempre em SDD. Só pula
    em pergunta puramente estética sem custo.
  - **Recomendação com o porquê, ancorada no repo/contexto** (não em "boa prática" genérica): *"por
    CT — teu modelo já isola tudo por CT via RLS"*. A recomendação NÃO substitui a pergunta.
  - **Aprofunde em rodadas** — se uma resposta abre uma decisão nova, pergunte de novo em cima dela.
    Ida-e-volta é o mecanismo de precisão, não desperdício; não corte rodadas pra "economizar".
- **Não pare em 4.** A ferramenta aceita no máximo 4 perguntas POR CHAMADA — isso é limite de
  ferramenta, NÃO do processo. Faça **quantas rodadas** forem necessárias (chame `AskUserQuestion`
  de novo, e de novo) até **zerar** a ambiguidade. Um SDD de verdade costuma ter muitas perguntas;
  poucas perguntas quase sempre = você assumiu algo.
- Dê uma **recomendação por pergunta** quando tiver uma — mas recomendação NÃO substitui a pergunta.
- **Não avance pro passo 3 enquanto sobrar um `[ESCLARECER]` aberto OU uma decisão do usuário
  não-confirmada.** Um plano técnico sobre um marcador não-resolvido é o "plano preciso e errado".

### 3. Planejar (COMO)

Agora sim o plano técnico, cada escolha rastreada a um requisito:

- **Arquitetura e fronteiras** — que módulos/camadas mudam, como conversam.
- **Escolhas de tech** com o *porquê* (por que esta lib/este padrão e não outro).
- **Dados/schema** — precisa de migration? qual? onde o projeto guarda o schema.
- **Interfaces/contratos** — APIs, eventos, tipos/DTOs, formato de payload.
- **Lista concreta de arquivos a criar/editar**, reusando o que já existe — **cite os caminhos**
  achados na exploração (ex.: "reusar `getAdvboxIds` em `...`"), não reinvente.

Antes de fechar o plano, passe por **três portões**. Cada um: **passa**, ou registra uma **exceção
justificada em 1 linha**.

- **Portão Simplicidade (YAGNI)** — nada especulativo, nada "pra depois". Mínimo de arquivos/
  abstrações novas. Se está criando estrutura pra um caso que ninguém pediu, corte.
- **Portão Anti-abstração** — use o framework/o padrão existente direto, uma representação só. Sem
  wrapper de um implementador só, sem factory de um produto só.
- **Portão Verificação** — todo pedaço do plano tem um jeito claro de ser checado (contrato
  definido, critério ligado a um teste/rota). Se não dá pra verificar, o plano ainda não está
  pronto.

### 4. Tarefas + Validação

Quebre o plano em **tarefas discretas e revisáveis**, ordenadas por dependência. Cada tarefa:

- caminho(s) de arquivo **exato(s)**;
- o que faz, em uma linha;
- pré-requisitos (que tarefa precisa vir antes — modelos antes de serviços, serviços antes de
  endpoints, etc.);
- `[P]` se pode rodar em paralelo com outra (independente);
- o **`CA-N`** que ela satisfaz.

**Portão Rastreabilidade** — cruze spec ↔ tarefas nos dois sentidos e pegue os dois órfãos que
nenhum outro portão pega: **critério sem tarefa** (ninguém vai implementar) e **tarefa sem `CA-N`**
(especulativa — ou liga a um critério, ou corta, por YAGNI). Proporcional à escala: **≥5 critérios
ou ≥8 tarefas → monte a tabela**; abaixo disso, uma frase confirmando que não há órfão basta.

```
CA-N          → Tarefa(s)      → Verificação
CA-1          → T3, T5         → teste do fluxo X
CA-2          → T1 (migration) → checagem do comportamento no banco
CA-4          → ⚠️ ÓRFÃO       → —   (falta tarefa)
T7 (índice)   → ⚠️ sem CA      → —   (justifique ou corte)
```

Depois, uma seção **Validação** que mapeia **cada critério de aceite a uma checagem concreta usando
os meios reais deste projeto**:

- os **testes/build/typecheck do próprio projeto** pra exercitar o fluxo ponta a ponta;
- checagem pelo **browser** pra frontend (o dono valida pela tela, não por print);
- os comandos de verificação que o projeto já usa no dia a dia.

**Não imponha** Cucumber, Pact ou TDD red-phase obrigatório — este projeto não valida assim, e
enfiar essa cerimônia é o anti-pattern de "tooling complexity".

## Formato de saída

Escreva **no arquivo de plano do modo de plano** (o mesmo de sempre) — **não** crie `spec.md`,
`plan.md` ou `tasks.md` avulsos. Ordem das seções:

```
Contexto  →  Spec (com critérios de aceite)  →  Esclarecimentos resolvidos
→  Plano (com o resultado dos 3 portões)  →  Tarefas  →  Validação
```

Isso já casa com o que o modo de plano exige (Contexto no topo, arquivos críticos nomeados, seção
de verificação no fim) — a spec e os portões entram *dentro* dessa mesma estrutura.

## Anti-patterns (do próprio SDD — evite, com o porquê)

- **Over-specification** — spec que vira pseudo-código. Você amarra a implementação à toa e perde a
  abstração. Especifique comportamento, não linhas de código.
- **Spec rot / bureaucracia** — spec que ninguém mantém, ou que virou formulário pra preencher. Se
  o processo não aumenta clareza, ele será ignorado. Mantenha enxuto.
- **Tooling complexity** — não recriar o Spec Kit inteiro (constitution.md, automação de branch,
  geração de N documentos). A disciplina mora nas instruções, não em ferramenta.
- **False confidence** — teste passando só prova que o código bate com a spec. Se a **spec** está
  errada, o código erra fiel. Por isso o passo 2 (esclarecer) é inegociável: é lá que a spec fica
  certa.

## Observações

- **Honre as convenções do projeto** (CLAUDE.md/AGENTS.md) ao planejar telas/serviços: siga os
  padrões, os componentes e o estilo que o próprio projeto já usa. O plano já nasce alinhado.
- **Saída sempre em PT-BR** — spec, perguntas de esclarecimento e plano.
- **Rigor proporcional.** Feature grande → spec + 3 portões completos. Mudança pequena mas ambígua
  → só o passo *Esclarecer* já paga o ingresso. Mudança trivial (rename, typo, 1-3 linhas) → **não
  dispare** SDD, é overkill.
- **Compõe com outras skills**: depois de planejar, uma skill de visualização pode mostrar o plano;
  no fim do trabalho, uma skill de PR pode abrir o PR no padrão do usuário.

## Quando o usuário digita /plan-sdd

Execute nesta ordem:

**Especificar** (rascunho da spec com `CA-N` numerados + varredura pela grade de ambiguidade →
marcadores `[ESCLARECER]`) → **Esclarecer** (portão: Explore
pro que o código responde, `AskUserQuestion` pro que só o usuário sabe — zere os marcadores) →
**explorar o código** pra fundamentar o COMO → **Planejar** (passe pelos 3 portões) →
**Tarefas + Validação** → **escrever no arquivo de plano** → `ExitPlanMode`.

Regra de ouro: **nunca** proponha arquitetura ou arquivos enquanto houver um `[ESCLARECER]` aberto —
e **nunca** finalize o plano nem chame `ExitPlanMode` sem ter feito pelo menos uma rodada de
`AskUserQuestion` (quantas forem necessárias pra zerar a ambiguidade). Poucas perguntas = você assumiu.
