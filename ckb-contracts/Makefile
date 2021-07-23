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

build-release:
	# sed is incompatible on Mac and Linux, refer <https://gist.github.com/andre3k1/e3a1a7133fded5de5a9ee99c87c6fa0d> to
	# change default sed on Mac.
	rm -rf build
	capsule build --release
	mv build/release build/release-devnet

	sed -i 's/\["contract", "devnet"\]/\["contract", "aggron"\]/g' lib/*/*.toml
	capsule build --release
	mv build/release build/release-aggron

	sed -i 's/\["contract", "aggron"\]/\["contract", "lina"\]/g' lib/*/*.toml
	capsule build --release
	mv build/release build/release-lina
	sed -i 's/\["contract", "lina"\]/\["contract", "devnet"\]/g' lib/*/*.toml

check-release:
	md5 build/release-*/*

.PHONY: ci
