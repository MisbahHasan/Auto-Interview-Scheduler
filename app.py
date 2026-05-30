import sqlite3
import json
import os
from datetime import datetime
from flask import Flask, send_file, jsonify, request, g
import getpass
import re
import json
import sqlite3
import asyncio
from typing import Literal
from datetime import datetime

from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.prebuilt import create_react_agent
from langchain.chat_models import init_chat_model
os.environ["GROQ_API_KEY"] = 'GROQ_API_KEY'
model = init_chat_model("openai/gpt-oss-120b", model_provider="groq")

ZAPIER_MEET_KEY = 'KEY'
ZAPIER_MAIL_KEY = 'KEY'

# ── LLM ──────────────────────────────────────────────────────────────────────
llm = model

def save_interview(details: dict) -> int:
    """Insert one interview record and return its row id."""
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            """
            INSERT INTO interviews
                (candidate, interviewer, scheduled_at, meet_link, status, raw_details)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                details.get("candidate", "Unknown"),
                details.get("interviewer", "Unknown"),
                details.get("scheduled_at", ""),
                details.get("meet_link", ""),
                details.get("status", "scheduled"),
                json.dumps(details),
            ),
        )
        conn.commit()
        return cur.lastrowid


def get_all_interviews():
    """Fetch every interview row (for debugging / display)."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute("SELECT * FROM interviews ORDER BY id DESC")]


# ── MCP tool loaders ──────────────────────────────────────────────────────────
meet_client = MultiServerMCPClient(
    {
        "zapier_meet": {
            "url": "https://mcp.zapier.com/api/v1/connect",
            "transport": "streamable_http",
            "headers": {"Authorization": f"Bearer {ZAPIER_MEET_KEY}"},
        }
    }
)

mail_client = MultiServerMCPClient(
    {
        "zapier_mail": {
            "url": "https://mcp.zapier.com/api/v1/connect",
            "transport": "streamable_http",
            "headers": {"Authorization": f"Bearer {ZAPIER_MAIL_KEY}"},
        }
    }
)


# ── Sub-agent nodes ───────────────────────────────────────────────────────────
async def meet_node(state: MessagesState):
    """Schedule an interview via Zapier calendar / Google Meet tools."""
    tools = await meet_client.get_tools()
    agent = create_react_agent(
        llm,
        tools=tools,
        prompt="You schedule interviews using the available calendar/meet tools.",
    )
    result = await agent.ainvoke(state)
    return {"messages": result["messages"]}


async def db_node(state: MessagesState):
    """
    Parse the scheduling result from the conversation and persist it to SQLite.

    The node asks the LLM to extract structured fields from the recent messages,
    then calls save_interview() to write the record.
    """
    # Ask the LLM to pull structured data out of the conversation so far
    extraction_prompt = (
        "Based on the conversation, extract interview scheduling details as JSON with keys: "
        "candidate (str), interviewer (str), scheduled_at (ISO datetime str), "
        "meet_link (str). Return ONLY valid JSON, nothing else."
    )

    extraction_response = await llm.ainvoke(
        state["messages"]
        + [{"role": "system", "content": extraction_prompt}]
    )

    details: dict = {}
    try:
        raw = extraction_response.content.strip()
        # Strip markdown fences if the model adds them
        raw = re.sub(r"```(?:json)?|```", "", raw).strip()
        details = json.loads(raw)
    except (json.JSONDecodeError, AttributeError):
        details = {"raw_response": extraction_response.content}

    row_id = save_interview(details)

    confirmation = (
        f"✅ Interview saved to SQLite database (row id={row_id}). "
        f"Details: {json.dumps(details, indent=2)}"
    )

    return {
        "messages": state["messages"]
        + [{"role": "assistant", "content": confirmation}]
    }


async def mail_node(state: MessagesState):
    """Send a confirmation email via Zapier email tools."""
    tools = await mail_client.get_tools()
    agent = create_react_agent(
        llm,
        tools=tools,
        prompt="You send emails to users using the available email tools.",
    )
    result = await agent.ainvoke(state)
    return {"messages": result["messages"]}


# ── Router ────────────────────────────────────────────────────────────────────
def router(state: MessagesState) -> Literal["meet_agent", "mail_agent", END]:
    """Root orchestrator: decide the next agent to invoke."""
    response = llm.invoke(
        state["messages"]
        + [
            {
                "role": "system",
                "content": (
                    "You are an orchestrator. Based on the conversation, decide the next action:\n"
                    "- Reply 'schedule' if an interview still needs to be scheduled.\n"
                    "- Reply 'email' if a confirmation email needs to be sent.\n"
                    "- Reply 'done' if the task is fully complete.\n"
                    "Reply with only one word."
                ),
            }
        ]
    )
    decision = response.content.strip().lower()
    if "schedule" in decision:
        return "meet_agent"
    elif "email" in decision:
        return "mail_agent"
    return END


# ── Graph ─────────────────────────────────────────────────────────────────────
def build_graph():
    builder = StateGraph(MessagesState)

    # Register nodes
    builder.add_node("meet_agent", meet_node)
    builder.add_node("db_agent",   db_node)   # ← NEW
    builder.add_node("mail_agent", mail_node)

    # Entry: router decides the first hop
    builder.add_conditional_edges(START, router)

    # After scheduling → always persist to DB first
    builder.add_edge("meet_agent", "db_agent")  # ← NEW (deterministic edge)

    # After DB write → back to router (may decide to send email next)
    builder.add_conditional_edges("db_agent", router)

    # After emailing → check if anything remains
    builder.add_conditional_edges("mail_agent", router)

    return builder.compile()


graph = build_graph()


# ── Run ───────────────────────────────────────────────────────────────────────
async def run(user_message: str):
    result = await graph.ainvoke(
        {"messages": [{"role": "user", "content": user_message}]}
    )
    for msg in result["messages"]:
        if hasattr(msg, "content") and msg.content:
            print(f"[{msg.__class__.__name__}]: {msg.content}")


# ── Entry point ───────────────────────────────────────────────────────────────

app = Flask(__name__)
DB_PATH = "interviews.db"

# ── DB helpers ────────────────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop("db", None)
    if db:
        db.close()

def row_to_dict(row):
    d = dict(row)
    raw = d.get("raw_details")
    if raw:
        try:
            d["raw_details"] = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            pass
    return d

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_file(os.path.join(app.root_path, "src", "index.html"))

@app.route("/api/stats")
def stats():
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM interviews").fetchone()[0]
    status_rows = db.execute(
        "SELECT status, COUNT(*) as cnt FROM interviews GROUP BY status"
    ).fetchall()
    status_summary = {r["status"]: r["cnt"] for r in status_rows}

    today = datetime.now().strftime("%Y-%m-%d")
    today_count = db.execute(
        "SELECT COUNT(*) FROM interviews WHERE scheduled_at LIKE ?",
        (f"{today}%",)
    ).fetchone()[0]

    return jsonify({
        "total": total,
        "today": today_count,
        "status_summary": status_summary,
    })

@app.route("/api/interviews")
def interviews():
    db = get_db()
    search = request.args.get("search", "").strip()
    status_filter = request.args.get("status", "").strip()
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 10))
    offset = (page - 1) * per_page

    conditions = []
    params = []

    if search:
        conditions.append("(candidate LIKE ? OR interviewer LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if status_filter:
        conditions.append("status = ?")
        params.append(status_filter)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total = db.execute(f"SELECT COUNT(*) FROM interviews {where}", params).fetchone()[0]
    rows = db.execute(
        f"SELECT * FROM interviews {where} ORDER BY id DESC LIMIT ? OFFSET ?",
        params + [per_page, offset]
    ).fetchall()

    return jsonify({
        "total": total,
        "page": page,
        "per_page": per_page,
        "interviews": [row_to_dict(r) for r in rows],
    })

@app.route("/api/interviews/<int:interview_id>")
def interview_detail(interview_id):
    db = get_db()
    row = db.execute("SELECT * FROM interviews WHERE id = ?", (interview_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(row_to_dict(row))

@app.route("/api/interviews/<int:interview_id>", methods=["PATCH"])
def update_interview(interview_id):
    db = get_db()
    data = request.get_json()
    allowed = {"status", "candidate", "interviewer", "scheduled_at", "meet_link"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return jsonify({"error": "Nothing to update"}), 400
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    db.execute(
        f"UPDATE interviews SET {set_clause} WHERE id = ?",
        list(updates.values()) + [interview_id]
    )
    db.commit()
    row = db.execute("SELECT * FROM interviews WHERE id = ?", (interview_id,)).fetchone()
    return jsonify(row_to_dict(row))

@app.route("/api/interviews/<int:interview_id>", methods=["DELETE"])
def delete_interview(interview_id):
    db = get_db()
    db.execute("DELETE FROM interviews WHERE id = ?", (interview_id,))
    db.commit()
    return jsonify({"deleted": interview_id})

@app.route("/api/schedule", methods=["POST"])
def schedule_interview():
    """Trigger the AI agent to schedule a new interview."""
    data = request.get_json()
    candidate = data.get("candidate", "").strip()
    interviewer = data.get("interviewer", "").strip()
    datetime_str = data.get("datetime", "").strip()
    notes = data.get("notes", "").strip()

    if not candidate or not interviewer or not datetime_str:
        return jsonify({"error": "candidate, interviewer, and datetime are required"}), 400

    # Build a natural language prompt for the AI agent
    prompt = (
        f"Schedule an interview for {candidate} with {interviewer} "
        f"on {datetime_str}."
        + (f" Notes: {notes}" if notes else "")
    )

    # ── Placeholder: wire your agent here ────────────────────────────────────
    # import asyncio
    asyncio.run(run(prompt))
    # ─────────────────────────────────────────────────────────────────────────

    return jsonify({
        "queued": True,
        "prompt": prompt,
        "message": "Agent task queued. The interview will be scheduled shortly.",
    })

@app.route("/api/statuses")
def statuses():
    db = get_db()
    rows = db.execute("SELECT DISTINCT status FROM interviews WHERE status IS NOT NULL").fetchall()
    return jsonify([r["status"] for r in rows])

if __name__ == "__main__":
    app.run(debug=True, port=5000)