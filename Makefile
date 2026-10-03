.PHONY: help run shot unit test test-all test-chips chips assets bench ci clean

PYTHON := python3
ZXBASIC := ../zxbasic
MODEL := 6128

help: ## Show this help message
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-11s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

run: ## Run a program. PROG=path/to/file.bas required, optional MODEL=464|664|6128 (default 6128) and DEFS="-D ..." passed to zxbc
	@if [ -z "$(PROG)" ]; then echo "Error: PROG is required (e.g., PROG=examples/bounce.bas)"; exit 1; fi
	CPC_MODEL=$(MODEL) $(ZXBASIC)/tools/cpc/run.sh $(abspath $(PROG)) -I $(abspath lib) $(DEFS)

shot: ## Run a program headless with screenshot. PROG=path/to/file.bas required, optional MODEL and DEFS
	@if [ -z "$(PROG)" ]; then echo "Error: PROG is required (e.g., PROG=examples/bounce.bas)"; exit 1; fi
	CPC_MODEL=$(MODEL) $(ZXBASIC)/tools/cpc/run.sh --shot $(abspath $(PROG)) -I $(abspath lib) $(DEFS)

unit: ## Run the tool unit tests (img2cpc, tmx2bas)
	$(PYTHON) -m unittest discover -s tests/tools

test: unit ## Unit tests, then conformance on Caprice32 (6128)
	$(PYTHON) tests/conformance/run.py

test-all: ## Run conformance tests on all models (464, 664, 6128)
	$(PYTHON) tests/conformance/run.py --model 464
	$(PYTHON) tests/conformance/run.py --model 664
	$(PYTHON) tests/conformance/run.py --model 6128

test-chips: chips ## Build chipsrun and run conformance tests with chips emulator
	$(PYTHON) tests/conformance/run.py --emu chips --model 6128
	$(PYTHON) tests/conformance/run.py --emu chips --model 464
	$(if $(wildcard tests/screens/run.py),$(PYTHON) tests/screens/run.py)

chips: ## Build chipsrun headless runner
	sh tools/chipsrun/build.sh

assets: ## Build assets
	sh tools/build_assets.sh

bench: ## Run benchmark
	$(PYTHON) tools/cpcrun.py examples/bounce.bas --zxbc-arg=-D --zxbc-arg=BENCH

ci: unit test-chips ## What CI runs - unit tests, then everything on chips (no Caprice32)

clean: ## Clean build artifacts
	rm -f tools/chipsrun/chipsrun
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
