.PHONY: assets build plus test test-plus bench disc
assets:  ## regenerate art, music and their includes
	sh build_assets.sh
build:   ## CPC 6128 + 464 builds, loader, build/starfall.dsk
	sh build_cpc.sh
test:    ## logic tests + screenshot goldens, CPC, on chips
	python3 tests/run.py
bench:   ## step rate on chips and Caprice32
	tests/bench.sh all
disc:    ## RUN"DISC picks the right build (Caprice32)
	python3 tests/disc.py
plus:    ## Starfall Plus: build/starplus.cpr (cartridge) and starplus.dsk (RUN"PLUS, 6128 Plus)
	sh build_plus.sh
test-plus: ## Starfall Plus logic, layer tests and screenshot goldens on Caprice32
	python3 tests/run.py --plus
