# eval (Phase 1)

The regression eval suite — the quality backbone (Doc 06). Placeholder until
Phase 1.

Will contain: a versioned corpus of ≥200 representative prompts with expected
behaviors, and a runner that generates each via the server and scores first-try
success, latency, and cost. It runs on every prompt/model change and **gates CI**:
no change ships if it regresses success on the corpus beyond a set threshold.

Every real production failure becomes a permanent eval case (RSK-02).
