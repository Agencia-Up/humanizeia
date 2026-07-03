// ============================================================================
// eval/central-scenarios.ts — cenários do gate R13 Inc2/G (agente CENTRAL, replay real).
// steps = rajadas (cada rajada é um "turno"; array interno = mensagens do bloco). O replay P0 reproduz o
// incidente do telefone 85988323679 (oferta SUV -> mais opções -> fotos do Kicks -> muda p/ hatch/sedan ->
// "qual carro pedi fotos?" -> "bonito ele" -> "onde fica a loja?" -> "quero saber da loja").
// ============================================================================
export type CentralScenario = {
  readonly id: string;
  readonly title: string;
  readonly kind: "replay_p0" | "long_flow";
  readonly note?: string;
  readonly steps: readonly (readonly string[])[];
};

export const CENTRAL_SCENARIOS: readonly CentralScenario[] = [
  {
    id: "p0-85988323679-replay",
    title: "Replay P0 — incidente tel 85988323679 (SUV → fotos Kicks → muda → memória → loja)",
    kind: "replay_p0",
    note: "Gate: lembra Kicks sem tool/mídia; não reenvia foto; endereço via tenant_business_info; 'quero saber da loja' não vira possuiTroca; 0 terminal_safe; ≤1 pergunta.",
    steps: [
      ["oi, tudo bem?"],
      ["tô procurando uma suv"],
      ["tem mais opções?"],
      ["manda as fotos do Nissan Kicks"],
      ["na verdade prefiro um hatch"],
      ["e sedan, tem alguma boa?"],
      ["qual carro eu pedi as fotos mesmo?"],
      ["bonito ele"],
      ["onde fica a loja?"],
      ["quero saber da loja"],
      ["e o horário de vocês?"],
    ],
  },
  {
    id: "c1-descoberta-estoque-fotos",
    title: "C1 — descoberta, estoque, detalhe, fotos e visita",
    kind: "long_flow",
    steps: [
      ["bom dia"],
      ["meu nome é Douglas"],
      ["quero uma suv até 90 mil"],
      ["tem mais opções?"],
      ["qual o preço do primeiro?"],
      ["e o câmbio dele?"],
      ["manda as fotos desse"],
      ["gostei"],
      ["qual carro eu pedi as fotos?"],
      ["esse aí é automático mesmo?"],
      ["vcs financiam?"],
      ["tenho um Gol 2015 pra dar na troca"],
      ["quero agendar uma visita"],
      ["sábado de manhã pode ser"],
      ["show, obrigado"],
    ],
  },
  {
    id: "c2-direcao-referencias",
    title: "C2 — mudança de direção, ordinal e referências ao veículo",
    kind: "long_flow",
    steps: [
      ["oi"],
      ["procuro um hatch econômico"],
      ["na verdade prefiro uma suv"],
      ["tem alguma automática?"],
      ["me mostra mais opções"],
      ["gostei do segundo"],
      ["manda as fotos dele"],
      ["qual a cor?"],
      ["qual carro eu pedi as fotos?"],
      ["quanto tá esse?"],
      ["e o de antes, o primeiro que você mostrou?"],
      ["onde vocês ficam?"],
      ["qual o horário?"],
      ["pode me passar mais detalhes do segundo?"],
      ["beleza, vou pensar"],
    ],
  },
  {
    id: "c3-qualificacao-compra-handoff",
    title: "C3 — qualificação, compra forte e handoff bloqueado sem funil",
    kind: "long_flow",
    steps: [
      ["quero comprar um carro AGORA, me passa pro vendedor"],
      ["oi"],
      ["é o Marcos"],
      ["quero uma picape"],
      ["até 120 mil"],
      ["tem mais alguma?"],
      ["manda foto da primeira"],
      ["gostei muito, quero fechar"],
      ["à vista"],
      ["não tenho carro na troca"],
      ["qual carro eu pedi foto mesmo?"],
      ["onde fica a loja pra eu buscar?"],
      ["quero saber da loja"],
      ["pode chamar o vendedor agora"],
      ["valeu"],
    ],
  },
];
