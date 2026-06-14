#!/usr/bin/env bash
# One-command health check for the whole codebase. Run from the repo root:
#
#   npm run verify              # fast core: typecheck + tests + builds (no browser)
#   npm run verify -- --with-eval   # also run the offline generation eval (needs Chromium)
#
# Exits non-zero if any step fails, so it doubles as a CI gate. No API keys,
# secrets, or network are needed for the core steps.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

WITH_EVAL=0
for arg in "$@"; do
  case "$arg" in
    --with-eval) WITH_EVAL=1 ;;
  esac
done

# --- pretty output ---------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; RED=""; YELLOW=""; DIM=""; RESET=""
fi

PASS=0; FAIL=0; FAILED_STEPS=()

step() {
  local name="$1"; shift
  printf "\n${BOLD}▶ %s${RESET}\n" "$name"
  if "$@"; then
    printf "${GREEN}✓ %s${RESET}\n" "$name"
    PASS=$((PASS+1))
  else
    printf "${RED}✗ %s${RESET}\n" "$name"
    FAIL=$((FAIL+1)); FAILED_STEPS+=("$name")
  fi
}

printf "${BOLD}Wild Card — verify${RESET} ${DIM}(node %s)${RESET}\n" "$(node -v 2>/dev/null || echo '?')"

# --- ensure deps -----------------------------------------------------------
if [ ! -d node_modules ]; then
  step "Install dependencies" npm install
fi

# --- core steps (browser-free, deterministic) ------------------------------
step "Runtime: build"            npm --workspace @wildcard/runtime run build
step "Server: typecheck"         npm --workspace @wildcard/server run typecheck
step "Server: unit tests"        npm --workspace @wildcard/server test
step "Web app: typecheck + build" npm --workspace @wildcard/host-web run build

# --- optional: offline generation eval (needs Playwright Chromium) ---------
if [ "$WITH_EVAL" = "1" ]; then
  printf "\n${BOLD}▶ Eval: offline generation pipeline (stub model)${RESET}\n"
  if WC_PROVIDER=stub npx tsx eval/run.ts; then
    printf "${GREEN}✓ Eval: offline generation pipeline${RESET}\n"
    PASS=$((PASS+1))
  else
    printf "${YELLOW}! Eval failed — if it's a missing browser, run:${RESET}\n"
    printf "  ${DIM}npx playwright install chromium${RESET}\n"
    FAIL=$((FAIL+1)); FAILED_STEPS+=("Eval (offline)")
  fi
else
  printf "\n${DIM}(skipping the offline eval — pass --with-eval to include it; it needs Chromium)${RESET}\n"
fi

# --- summary ---------------------------------------------------------------
printf "\n${BOLD}────────────────────────────────${RESET}\n"
if [ "$FAIL" -eq 0 ]; then
  printf "${GREEN}${BOLD}ALL GREEN${RESET} — %s checks passed.\n" "$PASS"
  printf "${DIM}The codebase is at a working level.${RESET}\n"
  exit 0
else
  printf "${RED}${BOLD}%s passed, %s FAILED${RESET}\n" "$PASS" "$FAIL"
  for s in "${FAILED_STEPS[@]}"; do printf "  ${RED}✗ %s${RESET}\n" "$s"; done
  exit 1
fi
