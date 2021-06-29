local-ci: clean-dev-env install-node-modules github-ci

github-ci: build-ckb-contracts start-docker
	bash tests/integration/integration-test.sh

install-node-modules:
	cd offchain-modules && yarn --frozen-lockfile
	cd eth-contracts && yarn --frozen-lockfile

start-docker:
	cd docker && docker-compose up -d

stop-docker:
	cd docker && docker-compose down

build-ckb-contracts:
	cd ckb-contracts && capsule build --release

deploy-eth-contracts:
	cd eth-contracts && yarn ci

clean-dev-env: stop-docker
