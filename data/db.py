"""
Camada de acesso a dados do relatório de avaliação de candidatos.

Fonte real: a view `miner_testdome.vw_ft_testdome_candidato_respostas`
(uma linha por pergunta respondida por um candidato).

Como isso é servido dentro de um Databricks App, a forma recomendada de
conectar é usando o SQL Warehouse anexado ao app como um "resource"
(veja: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/ ->
"Add resources" / "Configure apps"). Ao anexar um SQL Warehouse na
configuração do app, o Databricks injeta as variáveis de ambiente com o
host/http_path, e a autenticação do próprio app (service principal) é
usada automaticamente — não é preciso guardar token nenhum no código.

IMPORTANTE: os nomes exatos das variáveis de ambiente podem variar
conforme a versão da plataforma no momento em que vocês forem configurar
isso — confirme no painel do app, aba "Resources", qual env var o
Databricks gera para o warehouse escolhido, e ajuste as constantes abaixo
se necessário. Deixei isso como comentário porque não tenho acesso a um
workspace com Apps habilitado nesta sessão pra validar ao vivo.

Enquanto isso não está plugado, `get_candidate_report()` cai automaticamente
em dados de exemplo (MOCK_CANDIDATE) para você já visualizar o layout.
"""

import os
from datetime import datetime

try:
    from databricks import sql as databricks_sql  # databricks-sql-connector
except ImportError:  # pragma: no cover - só ausente em dev local sem a lib instalada
    databricks_sql = None

VIEW_NAME = "miner_testdome.vw_ft_testdome_candidato_respostas"

# Ajuste estes nomes se o painel "Resources" do seu app gerar variáveis diferentes.
ENV_HOSTNAME = "DATABRICKS_SERVER_HOSTNAME"
ENV_HTTP_PATH = "DATABRICKS_HTTP_PATH"
ENV_TOKEN = "DATABRICKS_TOKEN"  # em produção, o app usa o token do próprio service principal


def _score_tone(pct: float) -> str:
    # Alinhado com o painel gerencial atual do time: verde só para acerto
    # perfeito (100%), azul para o restante da faixa de aprovação, vermelho
    # abaixo de 50%. Ver docs/index.html e docs/gerencial.html para a versão
    # já publicada com esse critério.
    if pct >= 100:
        return "high"
    if pct >= 50:
        return "mid"
    return "low"


def _has_real_connection() -> bool:
    return bool(
        databricks_sql
        and os.environ.get(ENV_HOSTNAME)
        and os.environ.get(ENV_HTTP_PATH)
    )


def _query_real(candidate_id: str, test_id: str):
    """Consulta a view real via SQL Warehouse. Só roda se as env vars estiverem configuradas."""
    conn = databricks_sql.connect(
        server_hostname=os.environ[ENV_HOSTNAME],
        http_path=os.environ[ENV_HTTP_PATH],
        access_token=os.environ.get(ENV_TOKEN),  # None = usa auth automática do app, se suportado
    )
    query = f"""
        SELECT
            `Nome do Candidato`      AS nome,
            `Nome do Teste`          AS nome_teste,
            ordem_pergunta           AS ordem,
            `Conhecimento Técnico`   AS conhecimento,
            `Pergunta`               AS pergunta,
            `Senioridade`            AS senioridade,
            `Tipo de Pergunta`       AS tipo,
            `Peso`                   AS peso,
            `Pontuação`              AS pontuacao,
            `Feedback`               AS observacao,
            `Data da Resposta`       AS data_resposta
        FROM {VIEW_NAME}
        WHERE id_candidato = %(candidate_id)s
          AND id_test = %(test_id)s
        ORDER BY ordem_pergunta
    """
    with conn.cursor() as cur:
        cur.execute(query, {"candidate_id": candidate_id, "test_id": test_id})
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    conn.close()
    return _rows_to_report(rows)


def _rows_to_report(rows: list[dict]):
    if not rows:
        return None

    detalhamento = []
    skill_scores: dict[str, list[float]] = {}
    datas_resposta = []

    for r in rows:
        pontuacao = float(r["pontuacao"] or 0)
        detalhamento.append(
            {
                "ordem": r.get("ordem"),
                "conhecimento": r["conhecimento"],
                "pergunta": r["pergunta"],
                "senioridade": r["senioridade"],
                "tipo": r["tipo"],
                "peso": int(r["peso"]),
                "pontuacao": round(pontuacao),
                "score_tone": _score_tone(pontuacao),
                "observacao": r.get("observacao"),
            }
        )
        skill_scores.setdefault(r["conhecimento"], []).append(pontuacao)
        if r.get("data_resposta"):
            datas_resposta.append(r["data_resposta"])

    resumo_skills = [
        {
            "nome": nome,
            "percentual": round(sum(vals) / len(vals)),
            "tone": _score_tone(sum(vals) / len(vals)),
        }
        for nome, vals in skill_scores.items()
    ]

    percentual_geral = round(sum(d["pontuacao"] for d in detalhamento) / len(detalhamento))

    tempo_prova = None
    if len(datas_resposta) >= 2:
        delta = max(datas_resposta) - min(datas_resposta)
        total_seconds = int(delta.total_seconds())
        tempo_prova = f"{total_seconds // 3600:02d}:{(total_seconds % 3600) // 60:02d}:{total_seconds % 60:02d}"

    return {
        "nome": rows[0]["nome"],
        "nome_teste": rows[0]["nome_teste"],
        "percentual_geral": percentual_geral,
        "percentual_tone": _score_tone(percentual_geral),
        "data_avaliacao": min(datas_resposta).strftime("%d/%m/%Y") if datas_resposta else None,
        # "Tempo de prova" não existe como campo direto na view hoje — isto é uma
        # APROXIMAÇÃO pela diferença entre a primeira e a última resposta registrada,
        # não o tempo de prova real do TestDome. Sinalizar isso pro time antes de
        # confiar neste número; o ideal é trazer started_at/completed_at da camada
        # bronze/silver, se existir na origem.
        "tempo_prova": tempo_prova,
        "resumo_skills": resumo_skills,
        "detalhamento": detalhamento,
    }


MOCK_CANDIDATE = {
    "nome": "Diego Cordeiro",
    "nome_teste": "Avaliação Eng. Analytics",
    "percentual_geral": 86,
    "percentual_tone": "high",
    "data_avaliacao": "03/06/2026",
    "tempo_prova": "00:50:39",
    "resumo_skills": [
        {"nome": "Power BI", "percentual": 72, "tone": "mid"},
        {"nome": "SQL", "percentual": 98, "tone": "high"},
        {"nome": "Python", "percentual": 98, "tone": "high"},
    ],
    "detalhamento": [
        {"ordem": 1, "conhecimento": "PowerBI", "pergunta": "PowerBi_01_001", "senioridade": "Júnior", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 0, "score_tone": "low", "observacao": None},
        {"ordem": 2, "conhecimento": "PowerBI", "pergunta": "PowerBi_01_002", "senioridade": "Júnior", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 3, "conhecimento": "PowerBI", "pergunta": "PowerBi_01_003", "senioridade": "Júnior", "tipo": "Aberta", "peso": 100, "pontuacao": 75, "score_tone": "mid", "observacao": None},
        {"ordem": 4, "conhecimento": "PowerBI", "pergunta": "PowerBi_02_001", "senioridade": "Pleno", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 5, "conhecimento": "PowerBI", "pergunta": "PowerBi_02_002", "senioridade": "Pleno", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 0, "score_tone": "low", "observacao": None},
        {"ordem": 6, "conhecimento": "PowerBI", "pergunta": "PowerBi_02_003", "senioridade": "Pleno", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 7, "conhecimento": "PowerBI", "pergunta": "PowerBi_03_001", "senioridade": "Sênior", "tipo": "Aberta", "peso": 100, "pontuacao": 95, "score_tone": "high", "observacao": None},
        {"ordem": 8, "conhecimento": "PowerBI", "pergunta": "PowerBi_03_002", "senioridade": "Sênior", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 9, "conhecimento": "PowerBI", "pergunta": "PowerBi_03_003", "senioridade": "Sênior", "tipo": "Aberta", "peso": 100, "pontuacao": 75, "score_tone": "mid", "observacao": None},
        {"ordem": 10, "conhecimento": "SQL", "pergunta": "SQL_01_001", "senioridade": "Júnior", "tipo": "Aberta", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 11, "conhecimento": "SQL", "pergunta": "SQL_01_002", "senioridade": "Júnior", "tipo": "Aberta", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 12, "conhecimento": "SQL", "pergunta": "SQL_02_001", "senioridade": "Pleno", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 13, "conhecimento": "SQL", "pergunta": "SQL_02_002", "senioridade": "Pleno", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 14, "conhecimento": "SQL", "pergunta": "SQL_03_001", "senioridade": "Sênior", "tipo": "Aberta", "peso": 100, "pontuacao": 95, "score_tone": "high", "observacao": None},
        {"ordem": 15, "conhecimento": "SQL", "pergunta": "SQL_09_001", "senioridade": "Avançado", "tipo": "Aberta", "peso": 100, "pontuacao": 95, "score_tone": "high", "observacao": None},
        {"ordem": 16, "conhecimento": "Python", "pergunta": "Python_01_001", "senioridade": "Júnior", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 17, "conhecimento": "Python", "pergunta": "Python_01_002", "senioridade": "Júnior", "tipo": "Aberta", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 18, "conhecimento": "Python", "pergunta": "Python_02_001", "senioridade": "Pleno", "tipo": "Múltipla Escolha", "peso": 100, "pontuacao": 100, "score_tone": "high", "observacao": None},
        {"ordem": 19, "conhecimento": "Python", "pergunta": "Python_03_001", "senioridade": "Sênior", "tipo": "Aberta", "peso": 100, "pontuacao": 95, "score_tone": "high", "observacao": None},
        {"ordem": 20, "conhecimento": "Python", "pergunta": "Python_09_001", "senioridade": "Avançado", "tipo": "Aberta", "peso": 100, "pontuacao": 95, "score_tone": "high", "observacao": None},
    ],
}


def get_candidate_report(candidate_id: str | None, test_id: str | None):
    """Retorna o dict pronto pro template. Usa a view real se as credenciais
    do SQL Warehouse estiverem configuradas; senão cai no exemplo (MOCK_CANDIDATE),
    só para visualização do layout."""
    if candidate_id and test_id and _has_real_connection():
        return _query_real(candidate_id, test_id)

    if candidate_id or test_id:
        # Foi pedido um candidato específico mas não há conexão real configurada ainda.
        return None

    return MOCK_CANDIDATE
