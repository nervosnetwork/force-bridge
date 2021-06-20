
local-ci: clean-dev-env install-node-modules github-ci


github-ci: build-ckb-contracts start-docker
	cd offchain-modules && cp config.json.example config.json
	make deploy-eth-contracts
	bash offchain-modules/packages/scripts/src/service.sh -c -s -f

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


