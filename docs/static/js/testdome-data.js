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
