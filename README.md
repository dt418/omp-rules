# omp-rules

Plugin & tool provider for Oh My Pi (OMP) model catalogue sync, validation, and fallback chain rules maintenance.

## Installation

Install directly via OMP:

```bash
omp plugin install C:/Users/Thanh/omp-rules
# or via git repository when published:
# omp plugin install github:username/omp-rules
# or via npm:
# omp plugin install omp-rules
```

Or link for development:
```bash
omp plugin link C:/Users/Thanh/omp-rules
```

## Features

1. **Tool Function for Agents**:
   - `omp_rules` with actions: `sync`, `validate`, `generate`, `list`.

2. **Slash Commands**:
   - `/omp-rules sync` (or `/omp:rules sync`)
   - `/omp-rules validate`
   - `/omp-rules generate`
   - `/omp-rules list`

3. **Global CLI**:
   - Run `omp-rules sync` directly in any shell.
