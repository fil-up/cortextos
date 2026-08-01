---
name: knowledge-base
description: "You are about to research a topic, answer a factual question about the org, or look up context about a person, project, or tool. Before searching the web or asking the user, query the knowledge base first — the answer may already exist from a previous research session. After you complete any substantial research, ingest your findings so future agents do not repeat the same work. The KB is the org's shared memory across all agents."
triggers: ["knowledge base", "kb", "search knowledge", "query knowledge", "ingest", "rag", "semantic search", "what do we know about", "check knowledge", "save to kb", "index documents", "search docs", "look up", "query kb", "kb query", "kb ingest", "store research", "preserve findings", "check existing knowledge", "has anyone researched", "kb setup", "initialize knowledge base"]
external_calls: ["generativelanguage.googleapis.com"]
---

# Knowledge Base (RAG)

The knowledge base lets you search indexed documents using natural language — memory files, research notes, org knowledge. Query before searching externally. Ingest after completing research.

---

## Query (before starting research)

```bash
cortextos bus kb-query "your question" \
  --org $CTX_ORG \
  --agent $CTX_AGENT_NAME
```

Use this:
- Before starting any research task — check if knowledge already exists
- When referencing named entities (people, projects, tools) — check for existing context
- When answering factual questions about the org — query before searching externally

---

## Ingest (after completing research)

```bash
# Ingest to shared org collection (visible to all agents)
cortextos bus kb-ingest /path/to/docs \
  --org $CTX_ORG \
  --scope shared

# Ingest to your private collection (only visible to you)
cortextos bus kb-ingest /path/to/docs \
  --org $CTX_ORG \
  --agent $CTX_AGENT_NAME \
  --scope private
```

Ingest after:
- Completing substantive research (always ingest your findings)
- Writing or updating MEMORY.md
- Learning important facts about the org, users, or systems

---

## List Collections

```bash
cortextos bus kb-collections --org $CTX_ORG
```

---

## Checking Available Collections

List all KB collections for the org:

```bash
cortextos bus kb-collections --org $CTX_ORG
```

If no collections appear, the KB may not be configured yet — check that `GEMINI_API_KEY` is set in `orgs/$CTX_ORG/secrets.env`.

---

## Purging Stale / Poisoned Vectors

`cortextos bus kb-ingest --force` appends new chunks — it does NOT evict old ones. After replacing a source doc (e.g. HTML page superseded by a markdown file), verify the query returns the new source before declaring success.

If stale chunks persist, purge directly via ChromaDB Python client:

```python
# Find the ChromaDB path for your org:
# ~/.cortextos/default/orgs/<ORG>/knowledge-base/chromadb

/Users/phillipthomas/cortextos/knowledge-base/venv/bin/python3 << 'PYEOF'
import chromadb

client = chromadb.PersistentClient(
    path="/Users/phillipthomas/.cortextos/default/orgs/<ORG>/knowledge-base/chromadb"
)
col = client.get_collection("shared-<ORG>")

# Find IDs by source path
results = col.get(where={"source": {"$eq": "/path/to/stale-file.html"}})
print(f"Found {len(results['ids'])} chunks to delete")

# Delete them
col.delete(ids=results["ids"])
print("Deleted")
PYEOF
```

Then re-ingest the correct source and verify by query:

```bash
cortextos bus kb-ingest /path/to/fresh-file.md --org $CTX_ORG --scope shared --force
cortextos bus kb-query "the topic you fixed" --org $CTX_ORG | head -20
# Confirm: top results all from fresh source, zero traces of old file
```

**Notes:**
- `mmrag.py delete` may fail if config not found — fall back to raw chromadb client above
- `cortextos bus` has no kb-delete command (as of Jul 29 2026)
- Always verify by query result, not ingest exit code
- Incident ref: SWL Rule 3.03 KB poison Jul 24-29 2026, fixed by silver → [[silver]]

---

## Workflow Pattern

```
1. User asks question about <topic>
2. kb-query "<topic>" — check existing knowledge
3. If found → answer from KB, cite source
4. If not found → research externally
5. After research → kb-ingest findings
6. Answer user with fresh knowledge now in KB
```
