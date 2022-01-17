local-ci: clean-dev-env install-node-modules install-eth-contract github-ci

github-ci: build-ckb-contracts start-docker
	cd offchain-modules && yarn integration

install-node-modules:
	cd offchain-modules && yarn --frozen-lockfile && yarn build

install-eth-contract:
	cd eth-contracts && yarn --frozen-lockfile

start-docker:
	cd docker && docker-compose up -d

stop-docker:
	cd docker && docker-compose down

build-ckb-contracts:
	cd ckb-contracts && make build-release

deploy-eth-contracts:
	cd eth-contracts && yarn ci

clean-dev-env: stop-docker stop-cardano-testnet
	rm -rf workdir/integration

start-cardano-testnet:
	cd docker/cardano/basic_testnet && docker-compose up -d

stop-cardano-testnet:
	cd docker/cardano/basic_testnet && docker-compose down

cardano-test: clean-dev-env install-node-modules cardano-ci

cardano-ci: build-ckb-contracts start-docker start-cardano-testnet
	cd offchain-modules && yarn run cardano-integ
