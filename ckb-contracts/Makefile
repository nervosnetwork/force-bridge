ci: check-format-and-convention test-contract

check-format-and-convention:
	cargo fmt -- --check
	cargo clippy --all --tests -- -D warnings
	for c in $$(ls contracts); do echo "enter $$c"; cd contracts/$$c; cargo fmt -- --check; echo "check fmt done"; cd ../..; done

fmt:
	cargo fmt
	for c in $$(ls contracts); do echo "enter $$c"; cd contracts/$$c; cargo fmt; echo "fmt done"; cd ../..; done

update-and-audit:
	cargo update
	for c in $$(ls contracts); do echo "enter $$c"; cd contracts/$$c; cargo update; cargo audit; echo "update and audit scan done"; cd ../..; done

build-contract:
	capsule build

test-contract: build-contract
	cargo test -- --nocapture

.PHONY: ci
