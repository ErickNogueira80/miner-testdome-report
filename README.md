# Relatório de avaliação de candidatos — Miner

App Flask que replica o relatório de avaliação de candidatos (TestDome) direto
na marca da Miner, feito para rodar como um [Databricks App](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/).

## Rodando localmente

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Abra `http://127.0.0.1:8000` — sem nenhuma variável de ambiente configurada,
a página mostra um candidato de exemplo (dados fictícios em `data/db.py`,
`MOCK_CANDIDATE`), só pra visualizar o layout.

## Ligando na view real

Os dados de verdade vêm da view `miner_testdome.vw_ft_testdome_candidato_respostas`
(criada em `05_pipeline_testdome_views`). Isso exige que o workspace esteja no
tier **Premium** com um SQL Warehouse disponível — hoje o workspace `dbminer01`
está no tier Standard, então esse passo depende da migração já planejada
(ver o resumo em separado sobre isso).

Depois do upgrade:

1. No workspace, crie o app e anexe um SQL Warehouse a ele na aba **Resources**.
2. Confira, na tela do app, quais variáveis de ambiente o Databricks injeta
   para esse warehouse (o nome exato pode variar por versão da plataforma —
   não travei isso no código por não ter um workspace Premium à mão para
   validar ao vivo).
3. Ajuste as constantes `ENV_HOSTNAME`, `ENV_HTTP_PATH` e `ENV_TOKEN` no topo
   de `data/db.py` se os nomes forem diferentes dos que deixei como padrão.
4. Acesse `/?candidate_id=<id>&test_id=<id>` para ver um candidato real.

Enquanto isso não está plugado, a página sempre cai no candidato de exemplo.

**Observação sobre "Tempo de prova":** esse campo não existe direto na view.
O código aproxima pela diferença entre a primeira e a última resposta
registrada (`_rows_to_report` em `data/db.py`) — não é o tempo de prova real
do TestDome. Se a origem (bronze/silver) tiver `started_at`/`completed_at`,
vale trazer isso pra view em vez de usar essa aproximação.

## Publicando como Databricks App

```bash
databricks sync --watch . /Workspace/Users/<seu-email>/apps/miner-testdome-report
databricks apps deploy miner-testdome-report --source-code-path /Workspace/Users/<seu-email>/apps/miner-testdome-report
```

Ou configure o deploy direto a partir deste repositório Git — veja
["Deploy from a Git repository"](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/) na documentação do Databricks Apps.

## Estrutura

```
app.py              # rotas Flask
app.yaml             # config do Databricks App (comando de start)
data/db.py           # acesso a dados: view real (quando configurada) ou mock
templates/report.html
static/css/          # tokens de marca da Miner (colors/typography/spacing) + estilos do relatório
static/img/          # logo da Miner
```

## Marca

Usa os tokens oficiais do design system da Miner (`static/css/colors.css`,
`typography.css`, `spacing.css`) — nenhuma cor está escrita direto no HTML/CSS
do relatório, só as variáveis. Qualquer ajuste de paleta deve continuar vindo
desses arquivos.
