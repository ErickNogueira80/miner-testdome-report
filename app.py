"""
Relatório de avaliação de candidatos (TestDome) — app Flask para rodar como
Databricks App.

Rotas:
  GET /                                    -> mostra o candidato de exemplo (mock)
  GET /?candidate_id=<id>&test_id=<id>     -> mostra o candidato real (quando o
                                               SQL Warehouse estiver configurado
                                               em data/db.py)
  GET /healthz                              -> healthcheck simples
"""

from flask import Flask, render_template, request

from data.db import get_candidate_report

app = Flask(__name__)


@app.get("/")
def report():
    candidate_id = request.args.get("candidate_id")
    test_id = request.args.get("test_id")
    candidate = get_candidate_report(candidate_id, test_id)
    return render_template("report.html", candidate=candidate)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


if __name__ == "__main__":
    # Execução local: python app.py -> http://127.0.0.1:8000
    app.run(host="0.0.0.0", port=8000, debug=True)
