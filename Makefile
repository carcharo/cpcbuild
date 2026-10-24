.PHONY: help run shot unit test test-all test-chips test-bare test-bare-disc test-bare-cold test-zx test-games test-lamp reach-lamp lamp-plus test-lamp-plus test-plus test-cpcec cpcec cap32 chips assets bench ci clean test-vscode wasm test-wasm vsix ci-vscode

PYTHON := python3
# ?= so an environment ZXBASIC (CI, or a git worktree whose sibling is elsewhere) is exported to the recipes
ZXBASIC ?= ../zxbasic
# the emsdk for `make wasm` (ignored when it has no emsdk_env.sh: emcc on PATH is then used)
EMSDK ?= tools/cpcec/wasm/emsdk
MODEL := 6128
# ORG= (e.g. ORG=0x40) sets the program origin for run/shot; empty = compiler default
ORG :=

help: ## Show this help message
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-11s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

run: ## Run a program. PROG=path/to/file.bas required, optional MODEL=464|664|6128 (default 6128), ORG=0x.... and DEFS="-D ..." passed to zxbc
	@if [ -z "$(PROG)" ]; then echo "Error: PROG is required (e.g., PROG=examples/bounce.bas)"; exit 1; fi
	CPC_MODEL=$(MODEL) $(if $(ORG),ORG=$(ORG)) $(ZXBASIC)/tools/cpc/run.sh $(abspath $(PROG)) -I $(abspath lib) $(DEFS)

shot: ## Run a program headless with screenshot. PROG=path/to/file.bas required, optional MODEL, ORG and DEFS
	@if [ -z "$(PROG)" ]; then echo "Error: PROG is required (e.g., PROG=examples/bounce.bas)"; exit 1; fi
	CPC_MODEL=$(MODEL) $(if $(ORG),ORG=$(ORG)) $(ZXBASIC)/tools/cpc/run.sh --shot $(abspath $(PROG)) -I $(abspath lib) $(DEFS)

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

test-bare: test-bare-disc test-bare-cold ## Bare-metal (-D CPC_BAREMETAL) conformance and screenshots on chips: 464/6128 disc start and cold start (no firmware)

test-bare-disc: chips ## Bare-metal disc-start conformance (6128, 464) and screenshots on chips
	$(PYTHON) tests/conformance/run.py --emu chips --model 6128 --bare
	$(PYTHON) tests/conformance/run.py --emu chips --model 464 --bare
	$(PYTHON) tests/screens/run.py --bare

test-bare-cold: chips ## Bare-metal cold-start (no firmware) conformance (6128, 464) and screenshots on chips
	$(PYTHON) tests/conformance/run.py --emu chips --model 6128 --cold
	$(PYTHON) tests/conformance/run.py --emu chips --model 464 --cold
	$(PYTHON) tests/screens/run.py --cold

test-zx: chips ## Spectrum 48K/128K conformance and screenshot tests on chips (tests/zx)
	$(PYTHON) tests/zx/run.py

test-games: chips ## Starfall: logic tests and screenshot goldens for all four builds on chips
	$(PYTHON) games/shooter/tests/run.py
	$(PYTHON) games/shooter/tests/zx/run.py

test-lamp: chips ## Lamplighter: logic tests, whole-tower playthrough and screenshot goldens for the 464, 6128, Spectrum 48K and 128K builds on chips
	$(PYTHON) games/lamplighter/tests/run.py

lamp-plus: ## Lamplighter Plus: build/lampplus.dsk (RUN"PLUS, 6128 Plus) and lampplus.cpr (cartridge), games/lamplighter/build_plus.sh
	sh games/lamplighter/build_plus.sh

test-lamp-plus: ## Lamplighter Plus on Caprice32 and CPCEC (needs `make cap32 cpcec`; about 3 minutes): logic, playthrough, layer tests and screenshot goldens, disc and cartridge builds
	$(PYTHON) games/lamplighter/tests/run_plus.py

reach-lamp: ## Lamplighter: the reachability model over the map (about a minute): every lamp and door reachable in order, the recorded playthrough up to date
	$(PYTHON) games/lamplighter/tests/reach.py --check

test-plus: ## 6128 Plus on Caprice32 (headless): tests/plus smoke tests, conformance (firmware and --bare), screenshots (firmware and --bare)
	$(PYTHON) tests/plus/run.py
	$(PYTHON) tests/conformance/run.py --model plus
	$(PYTHON) tests/conformance/run.py --model plus --bare
	$(PYTHON) tests/screens/run.py --model plus
	$(PYTHON) tests/screens/run.py --model plus --bare
	$(PYTHON) games/shooter/tests/run.py --plus

# plus_core and plus_dma expect Caprice32's DMA status behaviour (active bits only
# from DmaStart/DmaStop); CPCEC, like the ASIC, clears a channel's bit when its list reaches STOP
# and shows DCSR bit 7, so they are left out of the CPCEC runs
CPCEC_SKIP :=
CPCEC_TESTS := $(filter-out $(addprefix tests/conformance/,$(addsuffix .bas,$(CPCEC_SKIP))),$(wildcard tests/conformance/*.bas))

cap32: ## Fetch, patch (tools/caprice32/caprice32-asic-regs.patch) and build Caprice32 into tools/caprice32/work/src/ (needs git, make, g++, SDL2, FreeType, libpng; the default cap32 for all tools)
	sh tools/caprice32/fetch_build.sh

cpcec: ## Fetch, patch (tools/cpcec/cpcbuild.patch) and build CPCEC into tools/cpcec/work/ (needs git, cc, SDL2)
	sh tools/cpcec/fetch_build.sh

test-cpcec: ## 6128 Plus on CPCEC (headless, needs `make cpcec`): smoke tests, conformance (firmware and --bare, minus CPCEC_SKIP), screens (firmware and --bare), Starfall Plus multiplexed cartridge (tests and goldens)
	$(PYTHON) tests/plus/run.py -k cpcec
	$(PYTHON) tests/conformance/run.py --emu cpcec --model plus $(CPCEC_TESTS)
	$(PYTHON) tests/conformance/run.py --emu cpcec --model plus --bare $(CPCEC_TESTS)
	$(PYTHON) tests/screens/run.py --emu cpcec
	$(PYTHON) tests/screens/run.py --emu cpcec --bare
	$(PYTHON) games/shooter/tests/run.py --plus --emu cpcec

test-vscode: ## CPC Game Studio extension: vitest unit tests, then extension-host tests (zxbc from ZXBASIC; on Linux run as xvfb-run -a make test-vscode)
	@[ -d vscode/cpcbuild-studio/node_modules ] || (cd vscode/cpcbuild-studio && npm ci)
	cd vscode/cpcbuild-studio && npm test

wasm: ## Build the SDL-free CPCEC WebAssembly core for CPC Game Studio Emulator into vscode/cpcbuild-emu/wasm (needs make cpcec; EMSDK=path to an activated emsdk, default tools/cpcec/wasm/emsdk, or emcc on PATH)
	@if [ -f "$(EMSDK)/emsdk_env.sh" ]; then EMSDK=$(EMSDK) sh tools/cpcec/wasm/build-host.sh; \
	elif [ -x "$(EMSDK)/upstream/emscripten/emcc" ]; then PATH="$(abspath $(EMSDK))/upstream/emscripten:$$PATH" EM_CONFIG="$(abspath $(EMSDK))/.emscripten" sh tools/cpcec/wasm/build-host.sh; \
	else sh tools/cpcec/wasm/build-host.sh; fi

test-wasm: wasm ## CPC Game Studio Emulator: vitest and extension-host tests, then the Node golden tests of the wasm core (needs make cpcec; on Linux run as xvfb-run -a make test-wasm)
	@[ -d vscode/cpcbuild-emu/node_modules ] || (cd vscode/cpcbuild-emu && npm ci)
	cd vscode/cpcbuild-emu && npm test && npm run test:golden

vsix: wasm ## Package both VS Code extensions: vscode/cpcbuild-studio/*.vsix and vscode/cpcbuild-emu/*.vsix (needs make cpcec for the emulator's ROMs)
	@[ -d vscode/cpcbuild-studio/node_modules ] || (cd vscode/cpcbuild-studio && npm ci)
	@[ -d vscode/cpcbuild-emu/node_modules ] || (cd vscode/cpcbuild-emu && npm ci)
	cd vscode/cpcbuild-studio && npm run package
	cd vscode/cpcbuild-emu && npm run package
	@ls -l vscode/cpcbuild-studio/*.vsix vscode/cpcbuild-emu/*.vsix

ci-vscode: test-vscode test-wasm ## The VS Code extension CI job, serially (not part of ci: it needs Node 22 and an emsdk)

chips: ## Build chipsrun (CPC) and zxrun (Spectrum) headless runners
	sh tools/chipsrun/build.sh

assets: ## Build assets
	sh tools/build_assets.sh

bench: ## Run benchmark
	$(PYTHON) tools/cpcrun.py examples/bounce.bas --zxbc-arg=-D --zxbc-arg=BENCH

ci: unit test-chips test-bare test-zx test-games test-lamp reach-lamp ## Everything CI runs, serially (CI itself runs these targets as parallel jobs) - unit, chips, bare-metal, zx, games, Lamplighter (no Caprice32: the Plus tests, test-plus, have their own CI job)

clean: ## Clean build artifacts
	rm -f tools/chipsrun/chipsrun
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
