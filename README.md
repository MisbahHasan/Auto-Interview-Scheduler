# Auto-Interview-Scheduler

A lightweight interview scheduling dashboard with a Flask backend, SQLite persistence, and an AI-powered scheduling workflow.

## Features

- Responsive dashboard with interview analytics
- Interview list with search, filter, and pagination
- AI-driven scheduling workflow using a conversational prompt
- SQLite database for storing interview records
- Simple Flask API for frontend integration
- GitHub Actions workflow for CI syntax checks

## Requirements

- Python 3.10+
- `pip`
- `git`

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/MisbahHasan/Auto-Interview-Scheduler.git
   cd Auto-Interview-Scheduler
   ```
2. Install dependencies:
   ```bash
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

## Running Locally

Start the app with:

```bash
python app.py
```

Then open `http://127.0.0.1:5000` in your browser.

## Configuration

The application currently includes placeholder API keys for AI and Zapier tools. Update the keys in `app.py` or set environment variables before running if you want the full AI scheduling workflow to work.

- `GROQ_API_KEY`
- `ZAPIER_MEET_KEY`
- `ZAPIER_MAIL_KEY`

## API Endpoints

- `GET /api/stats` — summary counts and status breakdown
- `GET /api/interviews` — list interviews with pagination, search, and filter
- `GET /api/interviews/<id>` — interview detail
- `PATCH /api/interviews/<id>` — update an interview
- `DELETE /api/interviews/<id>` — remove an interview
- `POST /api/schedule` — dispatch a new interview scheduling request to the AI agent

## GitHub Actions

A workflow is added at `.github/workflows/python-ci.yml`.
It runs on `push` and `pull_request` to `main`, installs dependencies, performs Python syntax checks, and validates that the Flask app imports successfully.

## Notes

- The UI lives in `src/index.html` with frontend logic in `static/app.js`.
- Interview data is stored in `interviews.db` by default.
- This repo is intended as a starting point for an AI-assisted interview scheduling dashboard.

![alt text](image.png)