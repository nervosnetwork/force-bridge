FROM ubuntu:18.04
ADD https://bitcoin.org/bin/bitcoin-core-0.20.0/bitcoin-0.20.0-x86_64-linux-gnu.tar.gz .
RUN tar -xzvf bitcoin-0.20.0-x86_64-linux-gnu.tar.gz -C ./
ADD entrypoint.sh ./
ADD miner.sh ./
ADD bitcoin.conf /etc/bitcoin/bitcoin.conf

EXPOSE 18443

ENTRYPOINT ["./entrypoint.sh"]
