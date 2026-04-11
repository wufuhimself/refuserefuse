from datetime import datetime

from airflow.decorators import dag, task
from airflow.operators.bash import BashOperator


@dag(
    dag_id="refuserefuse_starter",
    start_date=datetime(2026, 1, 1),
    schedule="0 9 * * *",
    catchup=False,
    tags=["refuserefuse", "starter", "analytics"],
    description="Starter DAG scaffold for RefuseRefuse analytics pipelines.",
)
def refuserefuse_starter_dag():
    announce_run = BashOperator(
        task_id="announce_run",
        bash_command="echo 'Starting RefuseRefuse starter pipeline for {{ ds }} (run_id={{ run_id }})'",
    )

    @task
    def extract(run_timestamp: str) -> dict:
        # Replace this stub with API/database extraction logic.
        return {
            "run_timestamp": run_timestamp,
            "source": "refuserefuse_stub_source",
            "records_seen": 0,
        }

    @task
    def transform(payload: dict) -> dict:
        # Replace with cleaning/normalization logic.
        payload["records_ready"] = payload["records_seen"]
        payload["status"] = "transformed"
        return payload

    @task
    def load(payload: dict) -> None:
        # Replace with writes to Postgres or data warehouse tables.
        print(
            "Starter load complete: "
            f"source={payload['source']} records_ready={payload['records_ready']}"
        )

    extracted = extract("{{ ts }}")
    transformed = transform(extracted)
    loaded = load(transformed)

    announce_run >> extracted
    transformed >> loaded


refuserefuse_starter_dag()
