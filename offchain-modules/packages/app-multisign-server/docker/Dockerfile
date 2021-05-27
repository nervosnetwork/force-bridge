FROM node:14
ENV PRIVKEY_INDEX=0
RUN mkdir -p /usr/app
WORKDIR /usr/app
RUN npm install --global lerna
RUN npm install -g ts-node
RUN git clone https://github.com/nervosnetwork/force-bridge.git
RUN cd force-bridge && git checkout main && cd offchain-modules && yarn && yarn run build

#COPY /usr/config.json /usr/app/force-bridge/offchain-modules/config.json
EXPOSE 8080

RUN ts-node /usr/app/force-bridge/offchain-modules/packages/app-multisign-server/src/index.ts --port 8080 --index ${PRIVKEY_INDEX}