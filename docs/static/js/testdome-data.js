/* Carrega e agrega os dados de docs/data/testdome_respostas.csv no navegador.
 * Nenhum dado de candidato fica escrito no código: tudo vem desse CSV, que é
 * um recorte da view miner_testdome.vw_ft_testdome_candidato_respostas
 * (sem e-mail, resposta em texto livre ou feedback). */

const CSV_PATH = "data/testdome_respostas.csv";
const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function scoreTone(pct) {
  if (pct >= 100) return "high";
  if (pct >= 50) return "mid";
  return "low";
}

function fmtDateAbrev(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = MESES_PT[d.getUTCMonth()];
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function fmtDuration(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function roundHalfUp(x) {
  return Math.floor(x + 0.5);
}

async function loadRows() {
  const res = await fetch(CSV_PATH);
  if (!res.ok) throw new Error("Não foi possível carregar " + CSV_PATH);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  // A exportação via Databricks grava valores nulos como a string literal
  // "null" (em vez de campo vazio), o que o PapaParse não reconhece como
  // ausência de valor. Normalizamos para null de verdade em todas as colunas.
  for (const row of parsed.data) {
    for (const key in row) {
      if (row[key] === "null") row[key] = null;
    }
  }
  return parsed.data;
}

function isAnswered(pont) {
  return !(pont === null || pont === undefined || pont === "");
}

/** Agrupa as linhas por candidato e calcula tudo que a tela individual precisa. */
function buildCandidates(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (r.id_candidato === null || r.id_candidato === undefined) continue;
    if (!byId.has(r.id_candidato)) byId.set(r.id_candidato, []);
    byId.get(r.id_candidato).push(r);
  }

  const candidates = [];
  for (const [id, qrowsRaw] of byId.entries()) {
    const qrows = qrowsRaw.slice().sort((a, b) => a.ordem_pergunta - b.ordem_pergunta);
    const first = qrows[0];

    const detalhamento = qrows.map((r) => {
      const answered = isAnswered(r.pontuacao);
      const pont = answered ? Number(r.pontuacao) : 0;
      return {
        ordem: r.ordem_pergunta,
        conhecimento: r.conhecimento_tecnico,
        pergunta: r.pergunta,
        senioridade: r.senioridade,
        tipo: r.tipo_pergunta,
        peso: r.peso,
        pontuacao: Math.round(pont),
        tone: scoreTone(pont),
        observacao: answered ? "" : "Não respondida",
      };
    });

    const skillMap = new Map();
    for (const d of detalhamento) {
      if (!skillMap.has(d.conhecimento)) skillMap.set(d.conhecimento, []);
      skillMap.get(d.conhecimento).push(d.pontuacao);
    }
    const resumo_skills = [...skillMap.entries()].map(([nome, vals]) => {
      const avg = roundHalfUp(vals.reduce((a, b) => a + b, 0) / vals.length);
      return { nome, percentual: avg, tone: scoreTone(avg) };
    });

    const percentual_geral = roundHalfUp(
      detalhamento.reduce((a, d) => a + d.pontuacao, 0) / detalhamento.length
    );

    // Perguntas não respondidas vêm com data_resposta vazia (PapaParse converte
    // para null), e `new Date(null)` resolveria silenciosamente para a época Unix
    // (1970), inflando artificialmente o "tempo de prova". Descartamos essas.
    const dates = qrows
      .map((r) => (r.data_resposta ? new Date(r.data_resposta) : null))
      .filter((d) => d && !isNaN(d));
    const minD = dates.length ? new Date(Math.min(...dates)) : null;
    const maxD = dates.length ? new Date(Math.max(...dates)) : null;

    candidates.push({
      id,
      nome: first.nome_candidato,
      nome_teste: first.nome_teste,
      percentual_geral,
      percentual_tone: scoreTone(percentual_geral),
      data_avaliacao_dt: minD,
      data_avaliacao: minD ? fmtDateAbrev(minD) : "—",
      tempo_prova: minD && maxD ? fmtDuration(maxD - minD) : "—",
      resumo_skills,
      detalhamento,
    });
  }

  candidates.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return candidates;
}

/** KPIs e séries dos gráficos do painel gerencial. */
function buildGerencial(rows, candidates) {
  const testes = new Set(rows.map((r) => r.id_test));
  // O CSV exporta booleanos no estilo Python ("True"/"False"), que o PapaParse
  // não converte para boolean nativo — por isso a comparação por string.
  const isTrue = (v) => v === true || String(v).toLowerCase() === "true";
  const iaCount = rows.filter((r) => isTrue(r.avaliado_por_ia)).length;

  const pontuacaoMedia = roundHalfUp(
    rows.reduce((a, r) => a + (isAnswered(r.pontuacao) ? Number(r.pontuacao) : 0), 0) / rows.length
  );
  const avaliacoesIaPct = (rows.length ? (iaCount / rows.length) * 100 : 0);

  // Custo estimado com a API da Anthropic (Claude) nas avaliações por IA.
  // custo_usd só existe (não nulo) para avaliações gravadas a partir de
  // 17/09/2026, quando o rastreamento de tokens/custo entrou no pipeline;
  // avaliações por IA anteriores a essa data não têm custo recuperável.
  const hasCusto = (v) => !(v === null || v === undefined || v === "");
  const linhasComCusto = rows.filter((r) => hasCusto(r.custo_usd)).length;
  const custoTotalUsd = rows.reduce((a, r) => a + (hasCusto(r.custo_usd) ? Number(r.custo_usd) : 0), 0);

  const tempoMedioMin =
    candidates.reduce((acc, c) => {
      if (!c.tempo_prova || c.tempo_prova === "—") return acc;
      const [h, m, s] = c.tempo_prova.split(":").map(Number);
      return acc + h * 60 + m + s / 60;
    }, 0) / (candidates.length || 1);

  const kpi = {
    candidatos_avaliados: candidates.length,
    avaliacoes_disponiveis: testes.size,
    pontuacao_media: pontuacaoMedia,
    avaliacoes_ia: avaliacoesIaPct.toFixed(1).replace(".", ",") + "%",
    tempo_medio: `${Math.floor(tempoMedioMin / 60)}h ${String(Math.round(tempoMedioMin % 60)).padStart(2, "0")}min`,
    custo_ia: "US$ " + custoTotalUsd.toFixed(2).replace(".", ","),
    custo_ia_rastreado: linhasComCusto > 0,
  };

  // Avaliados por teste (contagem de candidatos distintos por nome_teste)
  const porTeste = new Map();
  for (const c of candidates) porTeste.set(c.nome_teste, (porTeste.get(c.nome_teste) || 0) + 1);
  const avaliadosPorTeste = [...porTeste.entries()].sort((a, b) => b[1] - a[1]);

  // Avaliados por período (mês da primeira resposta de cada candidato)
  const porPeriodo = new Map();
  for (const c of candidates) {
    if (!c.data_avaliacao_dt) continue;
    const key = `${c.data_avaliacao_dt.getUTCFullYear()}${String(c.data_avaliacao_dt.getUTCMonth() + 1).padStart(2, "0")}`;
    porPeriodo.set(key, (porPeriodo.get(key) || 0) + 1);
  }
  const avaliadosPorPeriodo = [...porPeriodo.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // Pontuação média por teste e por conhecimento técnico (nível pergunta, não candidato)
  function avgBy(keyFn) {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(isAnswered(r.pontuacao) ? Number(r.pontuacao) : 0);
    }
    return [...m.entries()]
      .map(([k, vals]) => [k, roundHalfUp(vals.reduce((a, b) => a + b, 0) / vals.length)])
      .sort((a, b) => b[1] - a[1]);
  }

  const pontuacaoPorTeste = avgBy((r) => r.nome_teste);
  const pontuacaoPorConhecimento = avgBy((r) => r.conhecimento_tecnico);

  return { kpi, avaliadosPorTeste, avaliadosPorPeriodo, pontuacaoPorTeste, pontuacaoPorConhecimento };
}

/* ---- Nova visão do detalhamento individual: consolida o resultado do
 * candidato por senioridade, por conhecimento técnico e no cruzamento dos
 * dois, além de uma leitura automática do perfil resultante. ---- */

const SENIORIDADE_ORDEM = ["Júnior", "Pleno", "Sênior", "Avançado"];

/** Formata pontos com 1 casa decimal só quando necessário, usando vírgula
 * (padrão BR), igual ao resto do site (ex.: custo_ia em buildGerencial). */
function fmtPontos(n) {
  const arred = Math.round(n * 10) / 10;
  return Number.isInteger(arred) ? String(arred) : arred.toFixed(1).replace(".", ",");
}

/** Agrupa o detalhamento de um candidato (já calculado por buildCandidates)
 * por uma chave qualquer, somando pontos esperados/realizados. Cada pergunta
 * vale peso/10 pontos (a maioria dos testes usa peso=100, ou seja, 10 pontos
 * por pergunta); "realizado" é esse valor ponderado pela pontuação (0-100%)
 * obtida na pergunta. `ordem`, se informada, fixa a ordem das linhas; caso
 * contrário elas saem ordenadas pelo total de pontos esperados (desc). */
function agregarDesempenho(detalhamento, keyFn, ordem) {
  const map = new Map();
  for (const d of detalhamento) {
    const key = keyFn(d);
    const pts = d.peso / 10;
    if (!map.has(key)) map.set(key, { esperado: 0, realizado: 0 });
    const acc = map.get(key);
    acc.esperado += pts;
    acc.realizado += pts * (d.pontuacao / 100);
  }

  let entries = [...map.entries()];
  if (ordem) {
    entries.sort((a, b) => ordem.indexOf(a[0]) - ordem.indexOf(b[0]));
  } else {
    entries.sort((a, b) => b[1].esperado - a[1].esperado);
  }

  const linhas = entries.map(([nome, v]) => ({
    nome,
    esperado: v.esperado,
    realizado: v.realizado,
    pct: v.esperado ? roundHalfUp((v.realizado / v.esperado) * 100) : 0,
  }));
  const totalEsperado = linhas.reduce((a, l) => a + l.esperado, 0);
  const totalRealizado = linhas.reduce((a, l) => a + l.realizado, 0);

  return {
    linhas,
    total: {
      esperado: totalEsperado,
      realizado: totalRealizado,
      pct: totalEsperado ? roundHalfUp((totalRealizado / totalEsperado) * 100) : 0,
    },
  };
}

/** Leitura automática do perfil do candidato a partir dos percentuais por
 * conteúdo/senioridade. É uma heurística simples baseada só nos números —
 * o CSV publicado não traz o texto das respostas nem o feedback da IA, então
 * esse resumo não substitui uma leitura humana da prova. */
function resumirPerfil(porSenioridade, porConteudo) {
  if (!porConteudo.linhas.length) {
    return { titulo: "—", foco: "Sem perguntas suficientes para uma leitura de perfil.", notasPorConteudo: [] };
  }

  function nivelDe(pct) {
    if (pct >= 80) return "Domínio sólido, respostas consistentes.";
    if (pct >= 60) return "Bom domínio, com alguns pontos a evoluir.";
    if (pct >= 40) return "Conhecimento intermediário, com lacunas relevantes.";
    return "Conhecimento inicial, precisa de desenvolvimento.";
  }

  const ordenadoPorPct = porConteudo.linhas.slice().sort((a, b) => b.pct - a.pct);
  const melhor = ordenadoPorPct[0];
  const fracos = ordenadoPorPct.filter((l) => l.pct < 50 && l.nome !== melhor.nome);

  // Sobe de nível só enquanto os degraus anteriores também foram bem (>=60%):
  // um Sênior bom com um Pleno fraco no meio conta como "nível Júnior", não
  // como "Sênior" — não dá pra pular o degrau que falhou.
  let nivelAlcancado = "iniciante";
  for (const s of SENIORIDADE_ORDEM) {
    const linha = porSenioridade.linhas.find((l) => l.nome === s);
    if (linha && linha.pct >= 60) {
      nivelAlcancado = s;
    } else {
      break;
    }
  }

  const titulo = `Perfil ${nivelAlcancado} — foco em ${melhor.nome}`;
  const foco = fracos.length
    ? `Mais forte em ${melhor.nome}; ainda iniciante em ${fracos.map((f) => f.nome).join(" e ")}.`
    : `Desempenho equilibrado entre as áreas avaliadas, com destaque para ${melhor.nome}.`;

  const notasPorConteudo = porConteudo.linhas.map((l) => ({ nome: l.nome, pct: l.pct, nota: nivelDe(l.pct) }));

  return { titulo, foco, notasPorConteudo };
}

function buildDesempenho(candidate) {
  const porSenioridade = agregarDesempenho(candidate.detalhamento, (d) => d.senioridade, SENIORIDADE_ORDEM);
  const porConteudo = agregarDesempenho(candidate.detalhamento, (d) => d.conhecimento);

  // Cruzamento conteúdo x senioridade: mesma ordem de conteúdo da tabela
  // acima e, dentro de cada um, a ordem natural de senioridade.
  const combosOrdem = [];
  for (const l of porConteudo.linhas) {
    for (const s of SENIORIDADE_ORDEM) combosOrdem.push(l.nome + " / " + s);
  }
  const cruzado = agregarDesempenho(candidate.detalhamento, (d) => d.conhecimento + " / " + d.senioridade, combosOrdem);

  const perfil = resumirPerfil(porSenioridade, porConteudo);

  return { porSenioridade, porConteudo, cruzado, perfil };
}
