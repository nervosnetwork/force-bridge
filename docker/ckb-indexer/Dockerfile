FROM nervos/ckb-docker-builder:bionic-rust-1.51.0 as ckb-indexer-builder

WORKDIR /var/lib

RUN git clone https://github.com/nervosnetwork/ckb-indexer.git

RUN cd ckb-indexer && git checkout v0.3.0 && cargo build

FROM ubuntu:bionic

COPY --from=ckb-indexer-builder \
     /usr/lib/x86_64-linux-gnu/libssl.so.* \
     /usr/lib/x86_64-linux-gnu/libcrypto.so.* \
     /usr/lib/x86_64-linux-gnu/

COPY --from=ckb-indexer-builder \
    /var/lib/ckb-indexer/target/debug/ckb-indexer /bin/

EXPOSE 8116

CMD RUST_LOG=info ckb-indexer -s /tmp/ckb-indexer-test
