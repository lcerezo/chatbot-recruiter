# Should You Hire Luis? — a $150 resume chatbot

A recruiter-facing resume Q&A bot that runs a local LLM on an Intel N95 mini PC —
no GPU, no NPU, no cloud inference bill. Runs in my basement, sharing the box
with a recipe app.

Paste a job description and it analyzes fit requirement-by-requirement against
real resume data. It refuses to write code, stays on topic, and won't invent
experience.

## Why this exists

If you can build AI infrastructure that works on hardware this modest, imagine
what you'll do with a real budget. This repo is the proof of concept — and the
lessons learned (see [AGENT-NOTES.txt](AGENT-NOTES.txt)) are half the point.

## Architecture

```
browser → Cloudflare tunnel → nginx :8888 (container)
                               ├─ static files (this repo)
                               ├─ POST /ollama/api/chat → host Ollama :11434
                               ├─ GET  /ollama/api/tags → host Ollama :11434
                               └─ everything else under /ollama/ → 403
```

- **Model:** qwen2.5:1.5b via [Ollama](https://ollama.com), kept warm 30 min
- **Frontend:** vanilla JS, streaming NDJSON, no frameworks, no build step
- **Container:** nginx:alpine via podman (or docker), host networking
- **Rate limiting:** 6 req/min per visitor IP, burst 3
- **API lockdown:** only chat and tags endpoints are proxied; pull/delete/etc. are blocked

## Requirements

- Podman (or Docker) with compose
- Ollama on the host with the model pulled:

```sh
ollama pull qwen2.5:1.5b
```

## Running

```sh
podman-compose up -d --build     # or: docker compose up -d --build
```

Open http://localhost:8888.

## Customizing the resume data

Edit `resume-context.json` — plain JSON, add any keys you want; the model sees
all of it as context. Keep it under ~4KB for reasonable first-token time on
low-power hardware, and keep it compact (pretty-printing doubles the token cost).

## Prompt tuning workflow

The system prompt (`system-prompt.txt`) and the client-side guardrail regexes
(`guardrails.json`) are data files consumed by both the app and the eval
harness. **Never tune by vibes — run the evals:**

```sh
python3 eval.py        # 12 cases against local Ollama, temp 0, ~3 min on an N95
```

Only deploy at 12/12. Found a new failure mode? Add a case to `CASES` in
`eval.py` first, then tune until green.

Hard-won lesson: a 1.5B model **cannot reliably refuse code requests via
prompt alone** — its helpfulness training wins. The regex guardrails are
load-bearing for refusals; the prompt handles tone, honesty, and job-fit
analysis. And guardrails that are too aggressive block legitimate recruiter
questions ("I have a new role open…"), so the eval suite tests both directions.

More operational detail in [AGENT-NOTES.txt](AGENT-NOTES.txt) — written for
AI coding agents (and future me) maintaining this.

## Files

| File | Purpose |
|---|---|
| `index.html` / `style.css` | Chat UI, typewriter aesthetic |
| `app.js` | Chat logic, streaming, guardrails, history management |
| `system-prompt.txt` | System prompt template (`{{RESUME_DATA}}` placeholder) |
| `guardrails.json` | Client-side regex blocklist (shared with eval) |
| `resume-context.json` | The resume data |
| `eval.py` | Prompt eval harness — run after every prompt change |
| `nginx.conf` | Static serving, locked-down Ollama proxy, rate limiting |
| `Dockerfile` / `docker-compose.yml` | nginx:alpine container |
| `AGENT-NOTES.txt` | Operational lessons for agents/humans maintaining this |
