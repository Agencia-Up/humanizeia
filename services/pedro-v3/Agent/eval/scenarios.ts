// ============================================================================
// eval/scenarios.ts — roteiros sintéticos obrigatórios + incidentes sintéticos do v2.
// Cada `step` é uma RAJADA (array de falas do lead agregadas num único turno).
//
// LIMITAÇÃO REGISTRADA (regra da missão + auditoria Codex): NÃO são replays de conversas
// reais do v2. Acesso seguro às conversas reais exige anonimização (nome/telefone/CPF/IDs),
// inviável com segurança nesta rodada (sem SQL de escrita/reset). Por isso o `kind` é
// `synthetic_v2_incident`: fixtures SINTÉTICAS que reproduzem os CASOS DOCUMENTADOS no
// Brain/memória do v2 (dor real conhecida). Substituir por fixtures reais anonimizadas
// (kind futuro `replay_v2`) somente quando houver conversas reais anonimizadas de fato.
// ============================================================================
export type ScenarioKind = "synthetic" | "synthetic_v2_incident";
export type Scenario = { readonly id: string; readonly title: string; readonly kind: ScenarioKind; readonly note?: string; readonly steps: readonly (readonly string[])[] };

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "s1-descoberta-estoque-memoria-fotos",
    title: "Descoberta, estoque, memória e fotos",
    kind: "synthetic",
    steps: [
      ["Bom dia"],
      ["Já conheço a loja", "sou de Taubaté"], // rajada
      ["Douglas"],
      ["Quero SUV até 70 mil"],
      ["Tem mais opções?"],
      ["Gostei do segundo"],
      ["Me manda fotos do 2"],
      ["Bonito ele"],
      ["Ele é automático?"],
      ["Agora quero uma picape até 100 mil"],
      ["Não tenho carro para troca"],
      ["Quero financiar sem entrada, parcela até 1.800"],
      ["Consigo visitar sábado de manhã"],
    ],
  },
  {
    id: "s2-direcao-referencias",
    title: "Mudança de direção e referências",
    kind: "synthetic",
    steps: [
      ["Quero sedan até 80 mil"],
      ["Na verdade prefiro hatch automático"],
      ["Tem Onix ou HB20?"],
      ["Mostra mais opções"],
      ["Quero o terceiro"],
      ["Manda 3 fotos dele"],
      ["Não quero mais fotos"],
      ["Qual o valor dele?"],
      ["Tem algo mais barato?"],
      ["Volta naquele HB20 que você mostrou"],
    ],
  },
  {
    id: "s3-sdr-anti-handoff-precoce",
    title: "SDR e proteção contra handoff precoce",
    kind: "synthetic",
    note: "Lead de anúncio; responde o funil em mensagens separadas/rajadas; diz 'gostei' antes de concluir. Agente NÃO pode fazer handoff antecipado. CRM/handoff não estão ligados -> valida decisão/intenção + ausência de efeito externo.",
    steps: [
      ["Oi, vim pelo anúncio de vocês"],
      ["Meu nome é Douglas"],
      ["gostei"], // 'gostei' antes de concluir o funil -> nao pode acelerar handoff
      ["Sou de Taubaté", "já conheço a loja"], // rajada
      ["Não tenho carro para troca"],
      ["Quero financiar"],
      ["Tenho 10 mil de entrada"],
      ["Consigo visitar sábado de manhã"],
    ],
  },
  // ── Incidentes sintéticos do v2 (casos documentados no Brain; ver LIMITAÇÃO acima) ──
  {
    id: "r1-mais-opcoes-perdeu-categoria",
    title: "Incidente v2 (sintético): 'mais opções' perdeu categoria/faixa",
    kind: "synthetic_v2_incident",
    note: "Bug v2: ao pedir 'mais opções', o agente perdia o tipo/teto e mostrava carro aleatório. Invariante: 'mais opções' preserva tipo+precoMax e exclui os já mostrados.",
    steps: [
      ["Quero SUV até 70 mil"],
      ["Tem mais opções?"],
      ["E mais alguma?"],
    ],
  },
  {
    id: "r2-foto-ordinal-veiculo-errado",
    title: "Incidente v2 (sintético): foto repetida / veículo errado por ordinal",
    kind: "synthetic_v2_incident",
    note: "Bug v2: 'foto do N' enviava veículo fora da lista / reenviava indevidamente. Invariante: ordinal -> mesmo vehicleKey da lista renderizada; negação de foto -> sem mídia.",
    steps: [
      ["Quero hatch até 60 mil"],
      ["Me manda a foto do 3"],
      ["Manda de novo"],
      ["Não quero mais fotos"],
    ],
  },
  {
    id: "r3-repergunta-funil-handoff",
    title: "Incidente v2 (sintético): pergunta repetida / funil ignorado / handoff antecipado",
    kind: "synthetic_v2_incident",
    note: "Bug v2: repergunta o nome já dado; e handoff antes do funil mínimo. Invariante: não repergunta slot known; sem handoff antes de nome+contato+interesse.",
    steps: [
      ["Meu nome é Douglas"],
      ["Douglas"], // repete o nome -> nao pode reperguntar
      ["Quero comprar agora"], // tenta acelerar -> nao pode handoff sem funil minimo
    ],
  },
];
