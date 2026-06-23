// ============================================================================
// LÓGICA DE FOTO / VEÍCULO pura do Pedro v2 — SEM I/O, SEM Deno, SEM npm: (testável no tsx, $0).
// ----------------------------------------------------------------------------
// Extraído do orchestrator (que não importa no tsx por deps Deno/npm: no topo). Aqui mora a
// SELEÇÃO de qual veículo mostrar (pickReferencedVehicle), o gate "qual deles?" (buildVehiclePhotoReply),
// o match de modelo/atributo e a seleção de fotos. Fonte de vários bugs (#2 ambiguidade, #3 carro errado,
// "os outros"). Testado em scripts/regression/offline.ts. NÃO adicionar I/O aqui.
// ============================================================================
import { PhotoTarget, normalizePhotoText, detectPhotoTarget, queryIsBroadOrGenericVehicle } from "./decisionLogic.ts";

function normalizeVehicleKey(value: string) {
  return normalizePhotoText(value).replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}

function cleanVehiclePart(value?: string | number | null) {
  return String(value || "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function removeDuplicatedModelFromVersion(model: string, version: string) {
  const normalizedModel = normalizePhotoText(model);
  const normalizedVersion = normalizePhotoText(version);
  if (!normalizedModel || !normalizedVersion.startsWith(normalizedModel)) return version;
  const modelWords = normalizedModel.split(/\s+/).filter(Boolean).length;
  const versionWords = version.split(/\s+/).filter(Boolean);
  return versionWords.slice(modelWords).join(" ").trim() || version;
}

export function cleanVehicleLabel(vehicle: any) {
  const marca = cleanVehiclePart(vehicle?.marca);
  const modelo = cleanVehiclePart(vehicle?.modelo);
  const versao = removeDuplicatedModelFromVersion(modelo, cleanVehiclePart(vehicle?.versao));
  return [marca, modelo, versao, vehicle?.ano].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function vehicleKey(vehicle: any) {
  return normalizeVehicleKey([
    vehicle?.marca,
    vehicle?.modelo,
    vehicle?.versao,
    vehicle?.ano,
    vehicle?.preco,
    vehicle?.km,
  ].filter(Boolean).join("|"));
}

function clampVehicleIndex(index: number, vehicles: any[]) {
  return Math.max(0, Math.min(Math.max(vehicles.length - 1, 0), index));
}

function explicitVehicleOrdinal(message: string): number | null {
  const normalized = normalizePhotoText(message);
  if (/\b(primeiro|primeira|1|um|uma)\b/.test(normalized)) return 0;
  if (/\b(segundo|segunda|2|dois|duas)\b/.test(normalized)) return 1;
  if (/\b(terceiro|terceira|3|tres)\b/.test(normalized)) return 2;
  if (/\b(quarto|quarta|4)\b/.test(normalized)) return 3;
  if (/\b(quinto|quinta|5)\b/.test(normalized)) return 4;
  return null;
}

function messageVehicleAttributeScore(message: string, vehicle: any) {
  const normalized = normalizePhotoText(message);
  const indexed = normalizePhotoText([
    vehicle?.marca,
    vehicle?.modelo,
    vehicle?.versao,
    vehicle?.ano,
    vehicle?.cor,
    vehicle?.cambio,
    vehicle?.combustivel,
  ].filter(Boolean).join(" "));
  if (!normalized || !indexed) return 0;

  let score = 0;
  const wantsAuto = /\b(automatico|automatica|aut)\b/.test(normalized);
  const wantsManual = /\b(manual|mecanico|mecanica|mec)\b/.test(normalized);
  if (wantsAuto) score += /\b(automatico|automatica|aut)\b/.test(indexed) ? 8 : -6;
  if (wantsManual) score += /\b(manual|mecanico|mecanica|mec)\b/.test(indexed) ? 8 : -6;

  const colors = ["branco", "preto", "prata", "cinza", "azul", "vermelho", "laranja", "verde", "bege", "marrom"];
  for (const color of colors) {
    if (new RegExp(`\\b${color}\\b`).test(normalized)) score += indexed.includes(color) ? 5 : -2;
  }

  for (const body of ["sedan", "hatch", "suv", "picape", "pickup", "caminhonete"]) {
    if (new RegExp(`\\b${body}\\b`).test(normalized)) score += indexed.includes(body) ? 4 : -1;
  }

  // Ano e um discriminador FORTE entre unidades do mesmo modelo (ex.: HB20 2024 vs
  // HB20 2020). Pontua alto para o ano bater passar do limiar de selecao (>=5) e
  // vencer o empate de nome de modelo. Sem isso, "o 2020" caia no 1o da lista.
  for (const year of normalized.match(/\b(?:19|20)\d{2}\b/g) || []) {
    score += indexed.includes(year) ? 6 : -3;
  }

  const modelTokens = normalizePhotoText([vehicle?.modelo, vehicle?.versao].filter(Boolean).join(" "))
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  for (const token of modelTokens) {
    if (new RegExp(`\\b${token}\\b`).test(normalized)) score += 3;
  }

  return score;
}

function pickVehicleByMessageAttributes(message: string, vehicles: any[]) {
  const normalized = normalizePhotoText(message);
  const hasDiscriminator = /\b(automatico|automatica|aut|manual|mecanico|mecanica|mec|branco|preto|prata|cinza|azul|vermelho|laranja|sedan|hatch|suv|picape|pickup|caminhonete|20\d{2})\b/.test(normalized);
  if (!hasDiscriminator) return null;

  const ranked = vehicles
    .map((vehicle, index) => ({ vehicle, index, score: messageVehicleAttributeScore(message, vehicle) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) return null;
  const [best, second] = ranked;
  if (best.score >= 5 && (!second || best.score >= second.score + 2)) {
    return { index: best.index, reason: "message_attribute_match", key: vehicleKey(best.vehicle) };
  }
  return null;
}

// Casa o veiculo pelo NOME (marca/modelo) citado na mensagem (ex: "fotos do
// renegade" -> o Jeep Renegade do pool). Sem isso, "fotos do <modelo>" caia no
// default index 0 e mandava as fotos do PRIMEIRO carro da lista (carro errado).
function pickVehicleByModelName(message: string, vehicles: any[]) {
  const normalized = normalizePhotoText(message);
  if (!normalized) return null;
  const ranked = vehicles
    .map((vehicle, index) => {
      const tokens = Array.from(new Set(
        normalizePhotoText([vehicle?.marca, vehicle?.modelo].filter(Boolean).join(" "))
          .split(/\s+/)
          .filter((token) => token.length >= 3),
      ));
      let score = 0;
      for (const token of tokens) {
        if (new RegExp(`\\b${token}\\b`).test(normalized)) score += token.length >= 4 ? 4 : 2;
      }
      return { vehicle, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return null;
  return { index: ranked[0].index, reason: "model_name_match", key: vehicleKey(ranked[0].vehicle) };
}

// Tokens de RUIDO no nome do modelo (combustivel, cambio, cilindrada, trim, tracao):
// NAO identificam o modelo. CRITICO: sem filtrar, "Tracker ... Flex Aut" e "Renegade
// ... Flex Aut" compartilham "flex"/"aut" e seriam tratados como o MESMO modelo.
const MODEL_NOISE_TOKENS = new Set([
  "flex", "aut", "automatico", "automatica", "manual", "mecanico", "mecanica", "mec",
  "gasolina", "diesel", "alcool", "etanol", "turbo", "cvt", "tsi", "tgdi", "mpi", "gdi",
  "aspirado", "ecotec", "16v", "12v", "8v", "ltz", "lt", "ls", "4x2", "4x4", "cabine", "dupla",
]);

// Chave de MODELO = marca + 1o token significativo do modelo (ignora cor/ano/cilindrada/cambio/trim).
function vehicleModelKey(vehicle: any): string {
  const marca = normalizePhotoText(vehicle?.marca || "");
  const modelToken = normalizePhotoText(vehicle?.modelo || "")
    .split(/\s+/)
    .find((token) => token.length >= 3 && !MODEL_NOISE_TOKENS.has(token) && !/^\d/.test(token)) || "";
  return `${marca}:${modelToken}`;
}

// Dois veiculos sao do MESMO modelo se compartilham marca + nome do modelo.
export function sameVehicleModel(a: any, b: any): boolean {
  const keyA = vehicleModelKey(a);
  if (keyA.replace(":", "").trim() === "") return false;
  return keyA === vehicleModelKey(b);
}

// TRAVA DE MODELO DO TOPICO: o seletor SO pode escolher um veiculo cujo modelo bate com o topico
// atual. Cor/atributo seleciona DENTRO do topico — nunca troca de modelo. `topicAnchor` = veiculo-ancora.
export function pickReferencedVehicle(message: string, memory: any, vehicles: any[], topicAnchor?: any) {
  const explicitIndex = explicitVehicleOrdinal(message);
  if (explicitIndex !== null) {
    const index = clampVehicleIndex(explicitIndex, vehicles);
    return { index, explicit: true, reason: "explicit_ordinal", key: vehicleKey(vehicles[index]) };
  }

  // Nome do modelo/marca citado vence tudo (lead nomeou o carro de proposito).
  const modelMatch = pickVehicleByModelName(message, vehicles);
  if (modelMatch) {
    return { ...modelMatch, explicit: true };
  }

  // Atributo/cor ("manda o preto") SO escolhe DENTRO do modelo do topico (senao manda outro modelo).
  const attributeScope = topicAnchor
    ? vehicles.filter((v) => sameVehicleModel(v, topicAnchor))
    : vehicles;
  const attributeMatch = pickVehicleByMessageAttributes(message, attributeScope);
  if (attributeMatch) {
    const chosen = attributeScope[attributeMatch.index];
    const realIndex = vehicles.findIndex((v) => vehicleKey(v) === vehicleKey(chosen));
    return { ...attributeMatch, index: realIndex >= 0 ? realIndex : attributeMatch.index, explicit: true };
  }

  // Atributo nao casou DENTRO do topico mas ha ancora -> ancora o proprio topico (nao memoria velha).
  if (topicAnchor) {
    const anchorIndex = vehicles.findIndex((v) => vehicleKey(v) === vehicleKey(topicAnchor));
    if (anchorIndex >= 0) {
      return { index: anchorIndex, explicit: false, reason: "topic_anchor_vehicle", key: vehicleKey(topicAnchor) };
    }
  }

  const lastKey = memory?.ultima_foto?.veiculo_key || memory?.referencia?.ultimo_veiculo_key || null;
  if (lastKey) {
    const keyIndex = vehicles.findIndex((vehicle) => vehicleKey(vehicle) === lastKey);
    if (keyIndex >= 0) {
      return { index: keyIndex, explicit: false, reason: "last_photo_vehicle_key", key: lastKey };
    }
  }

  // MEM-6: indice de foto lembrado NAO vale entre POOLS diferentes. So usa indice em estado LEGADO sem key.
  const rememberedIndex = (!lastKey && Number.isFinite(Number(memory?.ultima_foto?.veiculo_index)))
    ? Number(memory.ultima_foto.veiculo_index)
    : (!lastKey && Number.isFinite(Number(memory?.referencia?.ultimo_veiculo_index)))
      ? Number(memory.referencia.ultimo_veiculo_index)
      : null;

  if (rememberedIndex !== null) {
    const index = clampVehicleIndex(rememberedIndex, vehicles);
    return { index, explicit: false, reason: "last_photo_vehicle_index", key: vehicleKey(vehicles[index]) };
  }

  return { index: 0, explicit: false, reason: "default_first_vehicle", key: vehicleKey(vehicles[0]) };
}

export function vehicleMatchesRequestedQuery(vehicle: any, query?: string | null) {
  if (!vehicle || queryIsBroadOrGenericVehicle(query)) return true;
  const q = normalizePhotoText(query || "");
  // Casa no nivel de MODELO: ignora trim/versao/cambio/cilindrada (evita falso-positivo que BLOQUEAVA
  // foto legitima — lead pede "compass", estoque resolve "Compass LONGITUDE 4X2 16V AUT" e "aut" nao batia).
  const vehModelToken = normalizePhotoText(vehicle?.modelo || "")
    .split(/\s+/)
    .find((t) => t.length >= 3 && !MODEL_NOISE_TOKENS.has(t) && !/^\d/.test(t)) || "";
  if (vehModelToken && new RegExp(`\\b${vehModelToken}\\b`).test(q)) return true;
  const vehicleText = normalizePhotoText([
    vehicle?.marca,
    vehicle?.modelo,
    vehicle?.versao,
    vehicle?.ano,
  ].filter(Boolean).join(" "));
  const queryTokens = q
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !MODEL_NOISE_TOKENS.has(token))
    .filter((token) => !/^(?:19|20)\d{2}$/.test(token))
    .filter((token) => ![
      "carro", "veiculo", "modelo", "versao", "foto", "fotos", "preco", "valor",
      "automatico", "automatica", "manual", "flex", "diesel", "gasolina",
    ].includes(token));
  if (queryTokens.length === 0) return true;
  return queryTokens.every((token) => vehicleText.includes(token));
}

export function buildBlockedWrongVehiclePhotoReply(requestedQuery: string) {
  return {
    ok: true,
    text: `Pra eu nao te mandar foto errada: vou confirmar as fotos do ${requestedQuery} certinho no estoque.`,
    source: "vehicle_photos_vehicle_mismatch_blocked",
    media: [],
  };
}

// Pedido resolvido SO por ATRIBUTO/COR (sem nome de modelo do pool nem ordinal). Se o pool for ambiguo,
// e mais seguro pedir esclarecimento que casar a cor contra uma lista velha e mandar outro modelo.
export function photoRequestIsAttributeOnly(message: string, pool: any[]): boolean {
  if (explicitVehicleOrdinal(message) !== null) return false;
  const normalized = normalizePhotoText(message);
  const hasAttribute = /\b(automatico|automatica|aut|manual|mecanico|mecanica|mec|branco|preto|prata|cinza|grafite|azul|vermelho|verde|laranja|amarelo|bege|marrom|vinho|sedan|hatch|suv|picape|pickup|caminhonete|20\d{2})\b/.test(normalized);
  if (!hasAttribute) return false;
  if (Array.isArray(pool) && pool.length > 0 && pickVehicleByModelName(message, pool)) return false;
  return true;
}

function uniqueIndexes(indexes: number[], total: number, max = 5) {
  const selected: number[] = [];
  for (const rawIndex of indexes) {
    const index = Math.max(0, Math.min(total - 1, Math.round(rawIndex)));
    if (!selected.includes(index)) selected.push(index);
    if (selected.length >= Math.min(max, total)) break;
  }
  return selected;
}

function fillIndexes(indexes: number[], total: number, max = 5, fallbackStart = 0, fallbackDirection: "forward" | "backward" = "forward") {
  const selected = uniqueIndexes(indexes, total, max);
  let index = fallbackStart;
  while (selected.length < Math.min(max, total) && index >= 0 && index < total) {
    if (!selected.includes(index)) selected.push(index);
    index += fallbackDirection === "forward" ? 1 : -1;
  }
  for (let fallback = 0; selected.length < Math.min(max, total) && fallback < total; fallback++) {
    if (!selected.includes(fallback)) selected.push(fallback);
  }
  return selected.slice(0, Math.min(max, total));
}

export function selectVehiclePhotos(vehicle: any, message: string, alreadySent: number[] = []) {
  const photos = [
    ...(Array.isArray(vehicle?.fotos) ? vehicle.fotos : []),
    vehicle?.principal_image,
  ].filter(Boolean).filter((url, position, all) => all.indexOf(url) === position);

  const total = photos.length;
  const target = detectPhotoTarget(message);
  if (total === 0) return { target, photos: [] as string[], sent_indexes: [] as number[] };
  if (total <= 5) {
    if (target === "overview" || target === "interior") {
      const idx = Array.from({ length: total }, (_, i) => i);
      return { target, photos: idx.map((i) => photos[i]), sent_indexes: idx };
    }
    const prefSmall: Record<string, number[]> = {
      front: [0, 1, 2], side: [2, 1, 3], rear: [total - 1, total - 2, 3],
      wheel: [3, 2, 4, 1], dashboard: [total - 1, total - 2, 2], seats: [total - 1, total - 2, 2],
      trunk: [total - 1, total - 2, 3],
    };
    const want = (prefSmall[target] || [0, 1, 2]).filter((i) => i >= 0 && i < total);
    const idx = [...new Set([...want, ...Array.from({ length: total }, (_, i) => i)])].slice(0, Math.min(total, 3));
    return { target, photos: idx.map((i) => photos[i]), sent_indexes: idx };
  }

  const middle = Math.max(4, Math.floor(total * 0.48));
  const late = Math.max(middle + 1, Math.floor(total * 0.66));
  const maxPhotos = target === "overview" || target === "interior" ? 5 : 3;
  const strategies: Record<PhotoTarget, number[]> = {
    overview: [0, 3, 6, 7, 8, 9, 4, 1, 2, middle, late],
    front: [0, 1, 2, 3, middle],
    side: [2, 3, 1, 4, middle],
    rear: [4, 5, 3, 6, Math.min(total - 1, late)],
    wheel: [3, 4, 2, 5, 1],
    interior: [5, 6, 7, 8, 9, middle, late, total - 1],
    dashboard: [8, 7, 9, 6, 10, 5, late, late + 1, total - 1],
    seats: [5, 6, 7, 8, 9, middle, late, total - 1],
    trunk: [Math.max(0, total - 2), Math.max(0, total - 3), 4, 5, late],
  };

  const interiorish = target === "interior" || target === "dashboard" || target === "seats";
  const ordered = uniqueIndexes(
    [...strategies[target], ...Array.from({ length: total }, (_, i) => i)],
    total,
    total,
  );
  const sentSet = new Set((alreadySent || []).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n)));
  const remaining = ordered.filter((i) => !sentSet.has(i));
  let indexes = remaining.slice(0, maxPhotos);
  if (indexes.length < maxPhotos) {
    for (const i of ordered) {
      if (indexes.length >= maxPhotos) break;
      if (!indexes.includes(i)) indexes.push(i);
    }
  }
  if (indexes.length === 0) {
    indexes = fillIndexes(strategies[target], total, maxPhotos, interiorish ? Math.min(total - 1, 5) : 0, "forward");
  }
  return { target, photos: indexes.map((index) => photos[index]), sent_indexes: indexes };
}

function pickPhrase(seed: string, phrases: string[]) {
  const index = normalizeVehicleKey(seed).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % phrases.length;
  return phrases[index] || phrases[0];
}

export function buildPhotoReplyText(target: PhotoTarget, vehicle: any, message: string) {
  const label = cleanVehicleLabel(vehicle) || "esse carro";
  const phrases: Record<PhotoTarget, string[]> = {
    overview: [
      "Da pra ter uma nocao bem melhor dele por essas fotos. O que voce achou?",
      "Essas fotos mostram melhor o estado dele. Fez sentido pra voce?",
      "Ele tem uma presenca boa nas fotos. Quer que eu confirme algum detalhe?",
    ],
    front: [
      "Pela frente da pra ver bem a conservacao dele. O que achou?",
      "Essa dianteira esta bem apresentada nas fotos. Quer ver mais algum detalhe?",
    ],
    side: [
      "A lateral ajuda bastante a ver alinhamento e cuidado. O que achou?",
      "Por esse angulo ja da pra sentir melhor o estado dele. Fez sentido?",
    ],
    rear: [
      "A traseira tambem parece bem inteira pelas fotos. Quer ver mais algum detalhe?",
      "Assim voce consegue avaliar melhor a conservacao. O que achou?",
    ],
    interior: [
      "Por dentro ele parece bem inteiro pelas fotos. O que achou?",
      "Interior costuma dizer muito sobre cuidado de uso. Esse aqui parece legal.",
      "Essas internas ajudam a ver melhor o acabamento. Fez sentido pra voce?",
    ],
    dashboard: [
      "Esse painel parece bem conservado nas fotos. Quer ver algum outro detalhe dele?",
      "Painel e comandos ajudam bastante a sentir o cuidado do carro. O que achou?",
      "Boa, pelo painel ja da pra ver melhor o estado de uso dele.",
    ],
    seats: [
      "Bancos bem cuidados fazem muita diferenca no dia a dia. O que achou?",
      "Essas fotos mostram melhor o estado dos bancos. Fez sentido pra voce?",
    ],
    trunk: [
      "Porta-malas e espaco interno contam bastante no uso real. Esse tamanho te atende?",
      "Da pra avaliar melhor o espaco por essas fotos. Faz sentido pra voce?",
    ],
    wheel: [
      "A roda ajuda bastante a ver cuidado de uso. Quer que eu confirme mais algum detalhe dele?",
      "Esse detalhe da roda ja mostra melhor a conservacao. O que achou?",
    ],
  };
  return pickPhrase(`${vehicleKey(vehicle)} ${target} ${message} ${label}`, phrases[target]);
}

// Lead quer ver TODOS os veículos ("manda todos", "os dois", "ambos", "as duas"). Caso real lead
// 98287-4078: o agente perguntou "de qual você quer ver?" 4x e travou — até quando o lead disse "manda
// todos" ele perguntou de novo. Aqui o fluxo de foto NUNCA re-pergunta: manda as fotos de todos.
export function leadRequestsAllVehiclePhotos(message?: string | null): boolean {
  const t = String(message || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /\b(todos|todas|os dois|as duas|os 2|as 2|ambos|ambas|manda tudo|manda td|todos eles|todas elas|os tres|as tres)\b/.test(t);
}

export function buildVehiclePhotoReply(memory: any, message: string, topicAnchor?: any) {
  const vehicles = Array.isArray(memory?.veiculos_apresentados) ? memory.veiculos_apresentados : [];
  if (vehicles.length === 0) {
    return {
      ok: true,
      text: "Claro. Me diz qual carro voce quer ver melhor que eu mando as fotos certinhas.",
      source: "vehicle_photos_need_reference",
      media: [],
    };
  }

  // LEAD QUER TODOS: manda as fotos de TODOS os veículos distintos (top 5 cada) num álbum só, com
  // legenda por veículo — NUNCA re-pergunta "de qual?". Resolve o caso do lead 98287-4078.
  const _distinct: any[] = [];
  for (const v of vehicles) if (!_distinct.some((d) => vehicleKey(d) === vehicleKey(v))) _distinct.push(v);
  if (leadRequestsAllVehiclePhotos(message) && _distinct.length >= 2) {
    const media: any[] = [];
    let order = 1;
    const labels: string[] = [];
    for (const v of _distinct.slice(0, 3)) {
      const top = (selectVehiclePhotos(v, "", []).photos || []).filter(Boolean).slice(0, 5);
      if (top.length === 0) continue;
      const lbl = cleanVehicleLabel(v) || [v?.marca, v?.modelo, v?.ano].filter(Boolean).join(" ");
      labels.push(lbl);
      top.forEach((file: string, i: number) => media.push({ file, type: "image", caption: i === 0 ? lbl : "", order: order++ }));
    }
    if (media.length > 0) {
      return {
        ok: true,
        text: `Perfeito! Vou te mandar as fotos das ${labels.length} opções pra você comparar 😊`,
        source: "vehicle_photos_reply",
        vehicle: _distinct[0],
        selected_index: 0,
        selected_vehicle_key: vehicleKey(_distinct[0]),
        selected_vehicle_label: labels.join(" e "),
        selected_vehicle_reason: "all_vehicles_requested",
        media,
      };
    }
  }

  const reference = pickReferencedVehicle(message, memory, vehicles, topicAnchor);

  // REDE DE SEGURANCA ANTI-MODELO-ERRADO: lead pediu por COR/ATRIBUTO sem nomear modelo nem ordinal, e o
  // pool tem >1 modelo distinto sem ancora -> a cor e ambigua entre modelos -> pede pra confirmar o modelo.
  const attributeOnly = reference.reason === "message_attribute_match";
  const distinctModelCount = (() => {
    const seen: any[] = [];
    for (const v of vehicles) {
      if (!seen.some((s) => sameVehicleModel(s, v))) seen.push(v);
    }
    return seen.length;
  })();
  if (attributeOnly && !topicAnchor && distinctModelCount > 1) {
    return {
      ok: true,
      text: "Pra eu nao te mandar foto trocada: qual deles voce quer ver, me confirma o modelo?",
      source: "vehicle_photos_ambiguous_model",
      media: [],
    };
  }

  // AMBIGUIDADE ENTRE UNIDADES (lead 99214-4889): lead aceitou foto ("Sim")/pediu "os outros" SEM dizer
  // qual, e ha VARIAS unidades. Sem sinal cairia no 1o (default) e despejaria o album. O certo (dono): lista
  // e PERGUNTA de qual. So dispara sem sinal nenhum (pick nao-explicito, nem continuacao do mesmo carro) E >=2 distintas.
  const _ambiguousPick = !reference.explicit
    && reference.reason !== "last_photo_vehicle_key"
    && reference.reason !== "last_photo_vehicle_index";
  const distinctKeyCount = new Set(vehicles.map((v: any) => vehicleKey(v)).filter(Boolean)).size;
  if (_ambiguousPick && distinctKeyCount >= 2) {
    const lines = vehicles.slice(0, 6).map((v: any, i: number) => {
      const lbl = cleanVehicleLabel(v) || [v?.marca, v?.modelo, v?.ano].filter(Boolean).join(" ");
      const cor = v?.cor ? `, ${String(v.cor).toLowerCase()}` : "";
      const preco = Number(v?.preco) > 0 ? `, R$ ${String(Math.round(Number(v.preco))).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}` : "";
      return `${i + 1}. ${lbl}${cor}${preco}`;
    });
    return {
      ok: true,
      text: `Tenho mais de uma opção pra te mostrar! De qual você quer ver as fotos?\n${lines.join("\n")}`,
      source: "vehicle_photos_pick_which",
      media: [],
    };
  }

  const index = reference.index;
  const vehicle = vehicles[index] || vehicles[0];
  const refKey = reference.key || vehicleKey(vehicle);
  const sameVehicle = memory?.ultima_foto?.veiculo_key && memory.ultima_foto.veiculo_key === refKey;
  const alreadySent = sameVehicle && Array.isArray(memory?.ultima_foto?.fotos_enviadas)
    ? memory.ultima_foto.fotos_enviadas
    : [];
  const selection = selectVehiclePhotos(vehicle, message, alreadySent);
  const photos = selection.photos;

  if (photos.length === 0) {
    return {
      ok: true,
      text: "Esse aqui nao trouxe fotos no estoque agora. Quer que eu chame um consultor pra conferir pra voce?",
      source: "vehicle_photos_unavailable",
      media: [],
    };
  }

  return {
    ok: true,
    text: buildPhotoReplyText(selection.target, vehicle, message),
    source: "vehicle_photos_reply",
    vehicle,
    selected_index: index,
    selected_vehicle_key: reference.key || vehicleKey(vehicle),
    selected_vehicle_label: cleanVehicleLabel(vehicle),
    selected_vehicle_reason: reference.reason,
    photo_target: selection.target,
    sent_photo_indexes: selection.sent_indexes,
    same_vehicle_as_last: Boolean(sameVehicle),
    media: photos.map((file: string, photoIndex: number) => ({
      file,
      type: "image",
      caption: "",
      order: photoIndex + 1,
    })),
  };
}
