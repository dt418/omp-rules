---
description: Sync, validate, and generate OMP model fallback rules
---
Run omp-rules command with arguments: $ARGUMENTS

Available options:
- sync: Prune dead/unavailable models from fallbackChains in ~/.omp/agent/config.yml
- validate: Inspect configuration validity without writing changes (dry-run)
- generate: Produce updated rules YAML based on available catalogued models
- list: List all catalogued available models
